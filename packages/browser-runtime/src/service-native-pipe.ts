import { endianness } from 'node:os'
import type { EventEmitter } from 'node:events'
import type { RpcMessage, MessageTransport } from './service-rpc.js'
const littleEndian = endianness() === 'LE'
export class FrameLimitError extends Error {
  constructor(
    public messageBytes: number,
    public maxFrameBytes: number
  ) {
    super('native pipe message exceeds frame limit')
  }
}
export function encodeFrame(message: string, maxFrameBytes = 0xffffffff) {
  const bytes = Buffer.from(message, 'utf8')
  if (bytes.length > maxFrameBytes) throw new FrameLimitError(bytes.length, maxFrameBytes)
  const frame = Buffer.alloc(4 + bytes.length)
  if (littleEndian) frame.writeUInt32LE(bytes.length)
  else frame.writeUInt32BE(bytes.length)
  bytes.copy(frame, 4)
  return frame
}
export class FrameDecoder {
  private chunks: Buffer[] = []
  private offset = 0
  byteLength = 0
  responseReceived = false
  constructor(
    public maxFrameBytes = 0xffffffff,
    public singleResponse = false
  ) {}
  private bytes(count: number, consume: boolean) {
    const first = this.chunks[0]
    if (first && first.length - this.offset >= count) {
      const result = first.subarray(this.offset, this.offset + count)
      if (consume) {
        this.offset += count
        this.byteLength -= count
        if (this.offset === first.length) {
          this.chunks.shift()
          this.offset = 0
        }
      }
      return result
    }
    const result = Buffer.allocUnsafe(count)
    let written = 0,
      index = 0,
      start = this.offset
    while (written < count) {
      const chunk = this.chunks[index]
      if (!chunk) throw Error('native pipe frame decoder underflow')
      written += chunk.copy(result, written, start, start + count - written)
      index++
      start = 0
    }
    if (consume) {
      let remaining = count
      while (remaining > 0) {
        const chunk = this.chunks[0]!
        const taken = Math.min(remaining, chunk.length - this.offset)
        this.offset += taken
        remaining -= taken
        if (this.offset === chunk.length) {
          this.chunks.shift()
          this.offset = 0
        }
      }
      this.byteLength -= count
    }
    return result
  }
  push(data: Uint8Array) {
    if (this.singleResponse && this.responseReceived && data.byteLength !== 0)
      throw Error('native pipe expected one response frame')
    if (data.byteLength) {
      this.chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
      this.byteLength += data.byteLength
    }
    const messages: string[] = []
    while (this.byteLength >= 4) {
      const header = this.bytes(4, false),
        size = littleEndian ? header.readUInt32LE() : header.readUInt32BE()
      if (size > this.maxFrameBytes) throw Error('native pipe frame exceeds limit')
      if (this.byteLength < 4 + size) break
      messages.push(
        this.bytes(4 + size, true)
          .subarray(4)
          .toString('utf8')
      )
    }
    if (this.singleResponse && messages.length) {
      if (messages.length !== 1 || this.byteLength !== 0)
        throw Error('native pipe expected one response frame')
      this.responseReceived = true
    }
    return messages
  }
}
export interface NativeSocket extends Pick<EventEmitter, 'on'> {
  write(data: Buffer): unknown
  end(): unknown
}
interface PipeOptions {
  maxFrameBytes?: number
  singleResponse?: boolean
  closedBeforeResponseMessage?: string
  decodeMessage: (value: unknown) => RpcMessage | undefined
  closeSocket?: () => unknown
}
const asError = (value: unknown) => (value instanceof Error ? value : Error(String(value)))
export class NativeMessagePipe implements MessageTransport {
  socket: NativeSocket | null
  closeListeners = new Set<(error?: Error) => unknown>()
  frameDecoder: FrameDecoder
  messageCallback: ((message: RpcMessage) => unknown) | null = null
  closePromise: Promise<void> | null = null
  terminalClose: { error: Error | undefined } | null = null
  pendingResponse: { message: RpcMessage } | null = null
  constructor(
    socket: NativeSocket,
    public options: PipeOptions
  ) {
    this.socket = socket
    this.frameDecoder = new FrameDecoder(options.maxFrameBytes, options.singleResponse)
    socket.on('data', (data: Uint8Array) => {
      if (this.socket === socket) this.handleData(data)
    })
    socket.on('error', (error: Error) => {
      if (this.socket === socket) void this.close(error)
    })
    socket.on('close', () => {
      if (this.socket !== socket) return
      if (this.pendingResponse) {
        try {
          this.messageCallback?.(this.pendingResponse.message)
          void this.markClosed()
        } catch (error) {
          void this.markClosed(asError(error))
        }
      } else
        void this.markClosed(
          Error(options.closedBeforeResponseMessage ?? 'native pipe closed before response')
        )
    })
  }
  sendMessage(message: unknown) {
    if (this.socket === null) throw Error('native pipe is closed')
    this.socket.write(encodeFrame(JSON.stringify(message), this.options.maxFrameBytes))
  }
  setMessageCallback(callback: (message: RpcMessage) => unknown) {
    this.messageCallback = callback
  }
  addCloseListener(callback: (error?: Error) => unknown) {
    this.closeListeners.add(callback)
    if (this.terminalClose !== null)
      void Promise.resolve()
        .then(() => callback(this.terminalClose?.error))
        .catch(() => {})
    return () => {
      this.closeListeners.delete(callback)
    }
  }
  isClosed() {
    return this.terminalClose !== null
  }
  async close(error?: Error) {
    this.closePromise ??= (async () => {
      const socket = this.socket
      await this.markClosed(error)
      if (socket)
        try {
          if (this.options.closeSocket) this.options.closeSocket()
          else socket.end()
        } catch {}
    })()
    await this.closePromise
  }
  handleData(data: Uint8Array) {
    try {
      for (const frame of this.frameDecoder.push(data)) {
        const message = this.options.decodeMessage(JSON.parse(frame))
        if (message !== undefined) {
          if (this.options.singleResponse) this.pendingResponse = { message }
          else this.messageCallback?.(message)
        }
      }
    } catch (error) {
      void this.close(asError(error))
    }
  }
  async markClosed(error?: Error) {
    if (this.terminalClose !== null) return
    this.terminalClose = { error }
    this.socket = null
    this.pendingResponse = null
    await Promise.allSettled([...this.closeListeners].map(async (callback) => callback(error)))
  }
}
export function decodeTransportMessage(value: unknown): RpcMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw Error('invalid native pipe transport message')
  return value as RpcMessage
}
export async function createNativeMessagePipe(
  path: string,
  host: { nativePipe?: { createConnection(path: string): Promise<NativeSocket> } }
) {
  if (!host.nativePipe || typeof host.nativePipe.createConnection !== 'function')
    throw Error('privileged native pipe bridge is not available; browser-client is not trusted')
  return new NativeMessagePipe(await host.nativePipe.createConnection(path), {
    decodeMessage: decodeTransportMessage
  })
}
