import { ComputerUseTransportError } from './errors.js'
const maxFrameBytes = 8 * 1024 * 1024
function checkSize(size: number) {
  if (size > maxFrameBytes)
    throw new ComputerUseTransportError(`Sky Computer Use native pipe frame is too large: ${size}`)
}
export function encodeMessageFrame(message: string): Buffer {
  const bytes = Buffer.from(message, 'utf8')
  checkSize(bytes.length)
  const frame = Buffer.alloc(bytes.length + 4)
  frame.writeUInt32LE(bytes.length, 0)
  bytes.copy(frame, 4)
  return frame
}
export function decodeMessageFrames(data: Buffer): { messages: string[]; remainingData: Buffer } {
  const messages: string[] = []
  let offset = 0
  while (data.length - offset >= 4) {
    const size = data.readUInt32LE(offset)
    checkSize(size)
    if (data.length - offset < size + 4) break
    messages.push(data.subarray(offset + 4, offset + 4 + size).toString('utf8'))
    offset += size + 4
  }
  return { messages, remainingData: data.subarray(offset) }
}
