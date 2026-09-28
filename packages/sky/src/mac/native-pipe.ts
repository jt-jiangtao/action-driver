import type { EventEmitter } from 'node:events'
import { ComputerUseError, ComputerUseTransportError } from './errors.js'
import { encodeMessageFrame, decodeMessageFrames } from './rpc-codec.js'
export interface NativePipe extends Pick<EventEmitter, 'on' | 'off'> {
  write(data: Uint8Array): unknown
  end(): unknown
}
export interface NativeRequest {
  requestType: string
  request: unknown
  timeoutSeconds: number
  codexMetadata?: unknown
}
export interface RequestTransport {
  readonly isClosed: boolean
  request(input: NativeRequest): Promise<unknown>
}
type Pending = {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}
const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
export class VersionMismatchError extends ComputerUseTransportError {}
function metadata(value: unknown): unknown {
  if (value == null || (typeof value === 'object' && !ArrayBuffer.isView(value))) return value
  return JSON.parse(Buffer.from(value as Uint8Array).toString('utf8'))
}
function response(value: unknown): {
  id: number
  result?: unknown
  error?: { code: number; message: string }
} {
  const invalid = () => {
    throw new ComputerUseTransportError('Sky Computer Use returned an invalid JSON-RPC response')
  }
  if (typeof value !== 'object' || value === null) return invalid()
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'number' || data.jsonrpc !== '2.0') return invalid()
  const hasResult = Object.hasOwn(data, 'result'),
    hasError = Object.hasOwn(data, 'error')
  if (hasResult === hasError) return invalid()
  if (hasResult) return { id: data.id, result: data.result }
  const error = data.error
  if (typeof error !== 'object' || error === null) return invalid()
  const details = error as Record<string, unknown>
  if (typeof details.code !== 'number' || typeof details.message !== 'string') return invalid()
  return { id: data.id, error: { code: details.code, message: details.message } }
}
/** Length-prefixed JSON-RPC session. Connection/startup is a separate responsibility. */
export class NativePipeTransport implements RequestTransport {
  private pipe: NativePipe | null
  private nextId = 1
  private buffer: Buffer = Buffer.alloc(0)
  private readonly pending = new Map<number, Pending>()
  private queue: Promise<void> = Promise.resolve()
  constructor(
    pipe: NativePipe,
    private readonly apiVersion: string
  ) {
    this.pipe = pipe
    pipe.on('data', (chunk: Uint8Array) => {
      try {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
        const { messages, remainingData } = decodeMessageFrames(this.buffer)
        this.buffer = remainingData
        for (const message of messages) {
          const decoded = response(JSON.parse(message))
          const pending = this.pending.get(decoded.id)
          if (!pending) continue
          this.pending.delete(decoded.id)
          clearTimeout(pending.timer)
          if (decoded.error)
            pending.reject(
              new ComputerUseError({ ...decoded.error, request: null, requestType: 'jsonRPC' })
            )
          else pending.resolve(decoded.result)
        }
      } catch (error) {
        this.fail(asError(error))
        pipe.end()
      }
    })
    pipe.on('error', (error: Error) => this.fail(error))
    pipe.on('close', () =>
      this.fail(new Error('Sky Computer Use native pipe closed before response'))
    )
  }
  get isClosed(): boolean {
    return this.pipe === null
  }
  request(input: NativeRequest): Promise<unknown> {
    const timeout = input.timeoutSeconds * 1000
    const result = this.queue.then(() =>
      this.send(
        'request',
        {
          clientApiVersion: this.apiVersion,
          codexTurnMetadata: metadata(input.codexMetadata),
          deadlineUnixMilliseconds: Date.now() + timeout,
          request: input.request,
          requestType: input.requestType
        },
        timeout
      )
    )
    this.queue = result.then(
      () => {},
      () => {}
    )
    return result
  }
  async ping(timeout: number): Promise<void> {
    const result = (await this.send('ping', { clientApiVersion: this.apiVersion }, timeout)) as {
      serverApiVersion?: unknown
    }
    if (result.serverApiVersion !== this.apiVersion)
      throw new VersionMismatchError(
        `Sky Computer Use API version mismatch: client=${this.apiVersion} server=${String(result.serverApiVersion)}`
      )
  }
  close(): void {
    const pipe = this.pipe
    this.fail(new Error('Sky Computer Use native pipe closed before response'))
    pipe?.end()
  }
  private send(method: string, params: unknown, timeout: number): Promise<unknown> {
    const pipe = this.pipe
    if (!pipe)
      return Promise.reject(new ComputerUseTransportError('Sky Computer Use native pipe is closed'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ComputerUseTransportError(`Sky Computer Use ${method} timed out`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        pipe.write(encodeMessageFrame(JSON.stringify({ id, jsonrpc: '2.0', method, params })))
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(asError(error))
      }
    })
  }
  private fail(error: Error): void {
    if (!this.pipe) return
    this.pipe = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
