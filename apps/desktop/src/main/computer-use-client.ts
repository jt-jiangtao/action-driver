import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { dirname } from 'node:path'
import {
  computerHelperRequest,
  computerHelperResponse,
  type ComputerHelperRequest
} from '@actiondriver/runtime-contracts'

type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
  removeAbort(): void
}

export type ComputerUseClientOptions = {
  helperPath: string
  socketPath: string
  tokenPath: string
  /** Overridable for tests; production launches the signed helper through LaunchServices. */
  launch?(helperPath: string, socketPath: string, tokenPath: string): void
  connectTimeoutMs?: number
}

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

function launchThroughLaunchServices(helperPath: string, socketPath: string, tokenPath: string): void {
  execFile('/usr/bin/open', ['-n', '-a', helperPath, '--args', '--socket', socketPath,
    '--token-file', tokenPath], (error, _stdout, stderr) => {
    if (error) {
      console.warn(`[computer-use] helper launch failed: ${error.message}${stderr ? ` ${stderr}` : ''}`)
    }
  })
}

/**
 * Talks to the Computer Use helper over its private Unix domain socket.
 *
 * The helper is started by LaunchServices rather than as a child process so macOS attributes its
 * TCC permissions to the helper itself; that is also why there is no stdio transport any more.
 */
export class ComputerUseClient {
  private socket: Socket | null = null
  private connecting: Promise<void> | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly waiting: Array<() => void> = []
  private busy = false
  private buffer = ''
  private closed = false
  private readonly token: string

  constructor(private readonly options: ComputerUseClientOptions) {
    mkdirSync(dirname(options.socketPath), { recursive: true, mode: 0o700 })
    this.token = this.resolveToken()
  }

  execute(request: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown> {
    const parsed = computerHelperRequest.parse(request)
    if (this.closed) return Promise.reject(new Error('ENGINE_UNAVAILABLE: helper client closed'))
    if (this.pending.has(parsed.requestId)) {
      return Promise.reject(new Error(`INVALID_REQUEST: duplicate request ${parsed.requestId}`))
    }
    if (this.busy) {
      return new Promise<unknown>((resolve, reject) => {
        this.waiting.push(() => {
          if (this.closed) {
            reject(new Error('ENGINE_UNAVAILABLE: helper client closed'))
            return
          }
          this.begin(parsed, signal).then(resolve, reject)
        })
      })
    }
    return this.begin(parsed, signal)
  }

  /** Sends a best-effort shutdown so the LaunchServices-started helper does not linger. */
  close(): void {
    if (this.closed) return
    if (this.socket && !this.socket.destroyed) {
      const request: ComputerHelperRequest = {
        version: 1, requestId: `shutdown-${randomBytes(6).toString('hex')}`,
        deadlineUnixMs: Date.now() + 1_000, operation: 'shutdown'
      }
      try { this.socket.write(`${JSON.stringify(request)}\n`) } catch { /* closing anyway */ }
    }
    this.closed = true
    this.failAll('ENGINE_UNAVAILABLE: helper client closed')
    // Give the helper a moment to act on the shutdown request before the socket goes away.
    const socket = this.socket
    this.socket = null
    for (const next of this.waiting.splice(0)) next()
    setTimeout(() => {
      socket?.destroy()
      rmSync(this.options.socketPath, { force: true })
    }, 400)
  }

  private begin(parsed: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown> {
    this.busy = true
    const run = this.dispatch(parsed, signal)
    const release = () => {
      this.busy = false
      this.waiting.shift()?.()
    }
    void run.then(release, release)
    return run
  }

  private async dispatch(parsed: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) throw new Error('ENGINE_UNAVAILABLE: helper client closed')
    if (signal?.aborted) throw new Error('CANCELLED: request aborted')
    // Connecting may include starting the helper through LaunchServices, which must not consume the
    // caller's deadline; the clock starts once the socket is ready.
    const socket = await this.ensureSocket()
    if (signal?.aborted) throw new Error('CANCELLED: request aborted')
    const remainingMs = parsed.deadlineUnixMs - Date.now()
    if (remainingMs <= 0) throw new Error('TIMED_OUT: request deadline elapsed')
    return new Promise<unknown>((resolve, reject) => {
      const finish = (error?: Error, value?: unknown) => {
        const item = this.pending.get(parsed.requestId)
        if (!item) return
        this.pending.delete(parsed.requestId)
        clearTimeout(item.timeout)
        item.removeAbort()
        if (error) reject(error)
        else resolve(value)
      }
      const cancel = (code: 'CANCELLED' | 'TIMED_OUT') => {
        this.sendCancel(parsed.requestId)
        finish(new Error(`${code}: ${parsed.requestId}`))
      }
      const onAbort = () => cancel('CANCELLED')
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(parsed.requestId, {
        resolve,
        reject,
        timeout: setTimeout(() => cancel('TIMED_OUT'), remainingMs),
        removeAbort: () => signal?.removeEventListener('abort', onAbort)
      })
      socket.write(`${JSON.stringify(parsed)}\n`)
    })
  }

  private async ensureSocket(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return this.socket
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => { this.connecting = null })
    }
    await this.connecting
    if (!this.socket) throw new Error('ENGINE_UNAVAILABLE: computer helper is not reachable')
    return this.socket
  }

  private async connect(): Promise<void> {
    const reused = await tryConnect(this.options.socketPath)
    if (reused) {
      this.attach(reused)
      return
    }
    // No helper listening: start one through LaunchServices, then wait for its socket.
    const launch = this.options.launch ?? launchThroughLaunchServices
    const timeout = this.options.connectTimeoutMs ?? 10_000
    for (let round = 0; round < 2; round += 1) {
      launch(this.options.helperPath, this.options.socketPath, this.options.tokenPath)
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const socket = await tryConnect(this.options.socketPath)
        if (socket) {
          this.attach(socket)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw new Error('ENGINE_UNAVAILABLE: computer helper did not start')
  }

  private attach(socket: Socket): void {
    this.socket = socket
    this.buffer = ''
    socket.setEncoding('utf8')
    socket.write(`${JSON.stringify({ token: this.token })}\n`)
    socket.on('data', (chunk: string) => this.receive(chunk))
    socket.on('close', () => this.detach(socket, 'ENGINE_UNAVAILABLE: computer helper exited'))
    socket.on('error', (error: Error) =>
      this.detach(socket, `ENGINE_UNAVAILABLE: ${error.message}`))
  }

  private detach(socket: Socket, message: string): void {
    if (this.socket !== socket) return
    this.socket = null
    this.buffer = ''
    this.failAll(message)
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_RESPONSE_BYTES) {
      this.failAll('INVALID_REQUEST: helper response too large')
      this.socket?.destroy()
      return
    }
    for (let newline = this.buffer.indexOf('\n'); newline >= 0; newline = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let response: ReturnType<typeof computerHelperResponse.parse>
      try { response = computerHelperResponse.parse(JSON.parse(line) as unknown) }
      catch {
        this.failAll('INVALID_REQUEST: malformed helper response')
        this.socket?.destroy()
        return
      }
      const pending = this.pending.get(response.requestId)
      if (!pending) continue
      this.pending.delete(response.requestId)
      clearTimeout(pending.timeout)
      pending.removeAbort()
      if (response.ok) pending.resolve(response.result)
      else pending.reject(new Error(`${response.error.code}: ${response.error.message}`))
    }
  }

  private sendCancel(targetRequestId: string): void {
    if (!this.socket || this.socket.destroyed) return
    const request: ComputerHelperRequest = {
      version: 1, requestId: `cancel-${targetRequestId}`,
      deadlineUnixMs: Date.now() + 1000,
      operation: 'cancel', targetRequestId
    }
    this.socket.write(`${JSON.stringify(request)}\n`)
  }

  private failAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.removeAbort()
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private resolveToken(): string {
    try {
      const existing = readFileSync(this.options.tokenPath, 'utf8').trim()
      if (existing) return existing
    } catch { /* first run */ }
    const token = randomBytes(24).toString('base64url')
    writeFileSync(this.options.tokenPath, token, { mode: 0o600 })
    chmodSync(this.options.tokenPath, 0o600)
    return token
  }
}

function tryConnect(socketPath: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    const fail = () => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(null)
    }
    socket.once('error', fail)
    socket.once('connect', () => {
      socket.removeListener('error', fail)
      resolve(socket)
    })
  })
}
