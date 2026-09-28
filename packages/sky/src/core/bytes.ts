import { readFile } from 'node:fs/promises'
export async function fromFilePath(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await readFile(path)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}
export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`
}
