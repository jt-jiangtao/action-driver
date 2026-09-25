import {
  computerHelperRequest,
  computerHelperResponse,
  type ComputerHelperRequest
} from '@actiondriver/runtime-contracts'
import type { Readable, Writable } from 'node:stream'

export type ComputerUseChild = {
  stdin: Writable
  stdout: Readable
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(): boolean
}

type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
  removeAbort(): void
}

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

export class ComputerUseClient {
  private child: ComputerUseChild | null = null
  private readonly pending = new Map<string, Pending>()
  private buffer = ''
  private closed = false

  constructor(private readonly start: () => ComputerUseChild) {}

  execute(request: ComputerHelperRequest, signal?: AbortSignal): Promise<unknown> {
    const parsed = computerHelperRequest.parse(request)
    if (this.closed) return Promise.reject(new Error('ENGINE_UNAVAILABLE: helper client closed'))
    if (this.pending.has(parsed.requestId)) {
      return Promise.reject(new Error(`INVALID_REQUEST: duplicate request ${parsed.requestId}`))
    }
    if (signal?.aborted) return Promise.reject(new Error('CANCELLED: request aborted'))
    const remainingMs = parsed.deadlineUnixMs - Date.now()
    if (remainingMs <= 0) return Promise.reject(new Error('TIMED_OUT: request deadline elapsed'))
    const child = this.ensureChild()
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
      child.stdin.write(`${JSON.stringify(parsed)}\n`)
      if (signal?.aborted) onAbort()
    })
  }

  close(): void {
    this.closed = true
    this.failAll('ENGINE_UNAVAILABLE: helper client closed')
    this.child?.kill()
    this.child = null
  }

  private ensureChild(): ComputerUseChild {
    if (this.child) return this.child
    const child = this.start()
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.buffer = ''
      this.failAll('ENGINE_UNAVAILABLE: computer helper exited')
    })
    child.on('error', (error) => {
      if (this.child !== child) return
      this.child = null
      this.buffer = ''
      this.failAll(`ENGINE_UNAVAILABLE: ${error.message}`)
    })
    return child
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_RESPONSE_BYTES) {
      this.failAll('INVALID_REQUEST: helper response too large')
      this.child?.kill()
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
        this.child?.kill()
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
    const child = this.child
    if (!child) return
    const request: ComputerHelperRequest = {
      version: 1, requestId: `cancel-${targetRequestId}`,
      deadlineUnixMs: Date.now() + 1000,
      operation: 'cancel', targetRequestId
    }
    child.stdin.write(`${JSON.stringify(request)}\n`)
  }

  private failAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.removeAbort()
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }
}
