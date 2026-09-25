import { randomUUID } from 'node:crypto'
import type { ImageAssetRef } from '@actiondriver/contracts'

type Metadata = Pick<ImageAssetRef, 'mimeType' | 'width' | 'height' | 'byteLength'>
type Pending = { metadata: Metadata; chunks: Buffer[]; received: number; nextIndex: number; expiresAt: number }
type Stored = { metadata: Metadata; bytes: Buffer; expiresAt: number }

export class VolatileComputerImages {
  private readonly pending = new Map<string, Pending>()
  private readonly images = new Map<string, Stored>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxBytes: number

  constructor(options: { now?: () => number; ttlMs?: number; maxBytes?: number } = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? 60_000
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024
  }

  begin(id: string, metadata: Metadata): void {
    this.sweep()
    if (this.pending.has(id) || this.images.size + this.pending.size >= 8)
      throw new Error('SCREENSHOT_CHANNEL_BUSY')
    if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 1 ||
        metadata.byteLength > this.maxBytes) throw new Error('SCREENSHOT_TOO_LARGE')
    if (metadata.mimeType !== 'image/jpeg' || !Number.isSafeInteger(metadata.width) ||
        !Number.isSafeInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 ||
        metadata.width > 4096 || metadata.height > 4096) throw new Error('SCREENSHOT_METADATA_INVALID')
    this.pending.set(id, { metadata, chunks: [], received: 0, nextIndex: 0,
      expiresAt: this.now() + this.ttlMs })
  }

  chunk(id: string, index: number, base64: string): void {
    const item = this.pending.get(id)
    if (!item || item.expiresAt <= this.now() || index !== item.nextIndex ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) ||
        base64.length > 400_000) throw new Error('SCREENSHOT_CHUNK_INVALID')
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length < 1 || item.received + bytes.length > item.metadata.byteLength)
      throw new Error('SCREENSHOT_CHUNK_INVALID')
    item.chunks.push(bytes)
    item.received += bytes.length
    item.nextIndex += 1
  }

  finish(id: string): ImageAssetRef {
    const item = this.pending.get(id)
    this.pending.delete(id)
    if (!item || item.expiresAt <= this.now() || item.received !== item.metadata.byteLength)
      throw new Error('SCREENSHOT_INCOMPLETE')
    const assetId = `volatile-computer:${randomUUID()}`
    this.images.set(assetId, { metadata: item.metadata,
      bytes: Buffer.concat(item.chunks, item.received), expiresAt: item.expiresAt })
    return { assetId, sessionId: 'computer-use', source: 'upload', ...item.metadata }
  }

  read(asset: ImageAssetRef): { bytes: Uint8Array; mimeType: ImageAssetRef['mimeType'] } {
    const image = this.images.get(asset.assetId)
    if (!image || image.expiresAt <= this.now() || asset.sessionId !== 'computer-use') {
      this.images.delete(asset.assetId)
      throw new Error('SCREENSHOT_EXPIRED: observe and capture again')
    }
    return { bytes: image.bytes, mimeType: image.metadata.mimeType }
  }

  discard(id: string): void { this.pending.delete(id); this.images.delete(id) }
  clear(): void { this.pending.clear(); this.images.clear() }

  private sweep(): void {
    for (const [id, item] of this.pending) if (item.expiresAt <= this.now()) this.pending.delete(id)
    for (const [id, item] of this.images) if (item.expiresAt <= this.now()) this.images.delete(id)
  }
}
