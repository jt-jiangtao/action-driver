import type { InteractionPayloadInput, InteractionPayloadView } from './interaction-store'

export const DEFAULT_INTERACTION_RETENTION = {
  maxTotalBytes: 256 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxTextPayloadBytes: 4 * 1024 * 1024
} as const

export function sanitizeCredentialPaths(value: unknown, paths: string[]): unknown {
  const cloned = cloneSerializable(value, new WeakSet<object>())
  for (const path of paths) removePath(cloned, path.split('.').filter(Boolean))
  return cloned
}

export function encodeInteractionPayload(
  input: InteractionPayloadInput,
  maxTextPayloadBytes = DEFAULT_INTERACTION_RETENTION.maxTextPayloadBytes
): InteractionPayloadView {
  if (input.kind === 'empty') {
    return view('empty', null, 0, false, null)
  }
  if (input.kind === 'binary-metadata') {
    return view(
      'binary-metadata',
      input.contentType ?? 'application/octet-stream',
      input.byteLength,
      false,
      input.summary ?? null
    )
  }
  try {
    const safeValue =
      input.kind === 'json'
        ? sanitizeCredentialPaths(input.value, input.secretPaths ?? [])
        : input.text
    const text = input.kind === 'json' ? JSON.stringify(safeValue, null, 2) : String(safeValue)
    const byteLength = Buffer.byteLength(text, 'utf8')
    const truncatedText = truncateUtf8(text, maxTextPayloadBytes)
    return view(
      input.kind,
      input.contentType ?? (input.kind === 'json' ? 'application/json' : 'text/plain'),
      byteLength,
      byteLength > maxTextPayloadBytes,
      truncatedText
    )
  } catch {
    return {
      ...view(input.kind, input.contentType ?? null, 0, false, null),
      unavailableReason: 'unsafe-to-persist'
    }
  }
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= maxBytes) return text
  let end = Math.max(0, maxBytes)
  while (end > 0 && ((buffer[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1
  return buffer.subarray(0, end).toString('utf8')
}

function view(
  kind: InteractionPayloadView['kind'],
  contentType: string | null,
  byteLength: number,
  truncated: boolean,
  text: string | null
): InteractionPayloadView {
  return { kind, contentType, byteLength, truncated, text, unavailableReason: null }
}

function cloneSerializable(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) throw new Error('UNSAFE_TO_PERSIST: cyclic payload')
  seen.add(value)
  if (Array.isArray(value)) {
    const cloned = value.map((entry) => cloneSerializable(entry, seen))
    seen.delete(value)
    return cloned
  }
  const cloned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    cloned[key] = cloneSerializable(entry, seen)
  }
  seen.delete(value)
  return cloned
}

function removePath(value: unknown, segments: string[]): void {
  if (segments.length === 0 || !value || typeof value !== 'object') return
  let current = value as Record<string, unknown>
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) return
    current = next as Record<string, unknown>
  }
  delete current[segments.at(-1)!]
}
