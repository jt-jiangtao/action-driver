export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export class WebProviderError extends Error {
  constructor(prefix: string, code: string) {
    super(`${prefix}_${code}`)
    this.name = 'WebProviderError'
  }
}

export async function withProviderBudget<T>(
  prefix: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const cancelled = new WebProviderError(prefix, 'CANCELLED')
  const timeout = new WebProviderError(prefix, 'TIMEOUT')
  const abort = () => controller.abort(cancelled)
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const reject = () => rejectAbort(controller.signal.reason)
  controller.signal.addEventListener('abort', reject, { once: true })
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(timeout), timeoutMs)
  try {
    if (signal?.aborted) {
      abort()
      await aborted
    }
    return await Promise.race([execute(controller.signal), aborted])
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    if (error instanceof WebProviderError) throw error
    throw new WebProviderError(prefix, 'NETWORK_FAILED')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', reject)
  }
}

export async function requestProviderJson(
  fetch: FetchLike,
  url: string,
  init: RequestInit,
  prefix: string,
  maxBytes: number,
  contentType = 'application/json'
): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'manual' })
  const fail = (code: string): never => {
    void response.body?.cancel().catch(() => undefined)
    throw new WebProviderError(prefix, code)
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))
    fail('REDIRECT_DENIED')
  if (!response.ok) {
    const code =
      response.status === 401
        ? 'AUTH_FAILED'
        : response.status === 403
          ? 'ACCESS_DENIED'
          : response.status === 429
            ? 'RATE_LIMITED'
            : [402, 432, 433].includes(response.status)
              ? 'QUOTA_EXCEEDED'
              : `HTTP_${response.status}`
    fail(code)
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes(contentType) || !response.body)
    fail('RESPONSE_INVALID')
  const reader = response.body!.getReader()
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  init.signal?.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    if (init.signal?.aborted) throw new WebProviderError(prefix, 'CANCELLED')
    while (true) {
      const next = await reader.read()
      if (init.signal?.aborted) throw new WebProviderError(prefix, 'CANCELLED')
      if (next.done) break
      length += next.value.byteLength
      if (length > maxBytes) {
        void reader.cancel().catch(() => undefined)
        throw new WebProviderError(prefix, 'RESPONSE_LIMIT')
      }
      chunks.push(next.value)
    }
  } finally {
    init.signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new WebProviderError(prefix, 'RESPONSE_INVALID')
  }
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function boundedText(value: string, limit: number): { text: string; truncated: boolean } {
  const characters = Array.from(value)
  return { text: characters.slice(0, limit).join(''), truncated: characters.length > limit }
}

export function containsCredential(value: string, credential: string): boolean {
  if (value.includes(credential)) return true
  try {
    return decodeURIComponent(value).includes(credential)
  } catch {
    return false
  }
}
