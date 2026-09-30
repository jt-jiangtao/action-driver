import { createHash, timingSafeEqual } from 'node:crypto'

export function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export function bearerToken(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

export function tokenMatches(token: string, digest: Buffer): boolean {
  const presented = tokenDigest(token)
  return presented.length === digest.length && timingSafeEqual(presented, digest)
}

export async function readLimitedBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  } finally {
    reader.releaseLock()
  }
}

export async function readLimitedBytes(
  request: Request,
  limit: number
): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    reader.releaseLock()
  }
}

export function credentialValues(value: unknown, paths: string[]): string[] {
  const values: string[] = []
  for (const path of paths) {
    let current = value
    for (const segment of path.split('.')) {
      if (!isRecord(current)) {
        current = undefined
        break
      }
      current = current[segment]
    }
    if (typeof current === 'string' && current.length > 0) values.push(current)
  }
  return values
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function redactSecrets(text: string, secrets: string[]): string {
  return secrets.reduce((sanitized, secret) => sanitized.split(secret).join('[redacted]'), text)
}
