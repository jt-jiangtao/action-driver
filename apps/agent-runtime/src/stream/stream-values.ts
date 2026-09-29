import { nextPartOrder, type ImageAssetRef, type MessageContentPart } from '@actiondriver/contracts'

/** Order reserved for one image inside its batch: the batch keeps `index` slots. */
export function imageOrder(
  parts: readonly MessageContentPart[],
  callId: string,
  index: number
): number {
  const batch = parts.find((part) => part.kind === 'image-batch' && part.callId === callId)
  return batch?.order === undefined ? nextPartOrder(parts) : batch.order + 1 + index
}

export function boundedJson(value: unknown, maxBytes: number): { value: string; truncated: boolean } {
  return boundedText(JSON.stringify(value), maxBytes)
}

export function boundedText(value: unknown, maxBytes: number): { value: string; truncated: boolean } {
  const text = typeof value === 'string' ? value : ''
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { value: text, truncated: false }
  let end = Math.min(text.length, maxBytes)
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1
  return { value: text.slice(0, end), truncated: true }
}

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  const parts = messageParts(content)
  if (parts)
    return parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('')
  if (content && typeof content === 'object' && 'text' in content) {
    const text = (content as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

export function messageParts(content: unknown): MessageContentPart[] | null {
  if (
    !content ||
    typeof content !== 'object' ||
    !('parts' in content) ||
    !Array.isArray(content.parts)
  )
    return null
  return content.parts as MessageContentPart[]
}

export function isImageAssetRef(value: unknown): value is ImageAssetRef {
  if (!value || typeof value !== 'object') return false
  const asset = value as Partial<ImageAssetRef>
  return (
    typeof asset.assetId === 'string' &&
    typeof asset.sessionId === 'string' &&
    (asset.mimeType === 'image/png' ||
      asset.mimeType === 'image/jpeg' ||
      asset.mimeType === 'image/webp') &&
    typeof asset.width === 'number' &&
    typeof asset.height === 'number' &&
    typeof asset.byteLength === 'number' &&
    asset.source === 'generated'
  )
}

export function toStreamError(value: unknown): {
  code: string
  message: string
  retryable: boolean
} | null {
  if (!value || typeof value !== 'object') return null
  const error = value as { code?: unknown; message?: unknown; retryable?: unknown }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return null
  return { code: error.code, message: error.message, retryable: error.retryable === true }
}

/** The store error code (for example `INPUT_FILE_NOT_FOUND`), so a failed attachment is diagnosable. */
export function attachmentErrorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'UNKNOWN'
}

export function withAssets(output: unknown, assets: unknown[]): unknown {
  if (!assets.length) return output
  return {
    ...(output && typeof output === 'object' && !Array.isArray(output) ? output : {}),
    assets
  }
}
