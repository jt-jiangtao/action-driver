import { MAX_IMAGE_BYTES } from './session-asset-store'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
export type ImageGenerationRequest = {
  baseUrl: string
  apiKey: string
  modelId: string
  prompt: string
}

const MAX_RESPONSE_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024

export function createImageGenerationAdapter(
  options: { fetch?: FetchLike; timeoutMs?: number } = {}
) {
  const fetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 120_000
  return {
    async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<Uint8Array> {
      const controller = new AbortController()
      const onAbort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      const timeout = setTimeout(
        () => controller.abort(new Error('IMAGE_PROVIDER_TIMEOUT')),
        timeoutMs
      )
      try {
        const response = await fetch(`${request.baseUrl.replace(/\/+$/, '')}/images/generations`, {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${request.apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: request.modelId,
            prompt: request.prompt,
            n: 1,
            response_format: 'b64_json'
          })
        })
        if (!response.ok) throw new Error(`IMAGE_PROVIDER_HTTP_${response.status}`)
        const body = await readLimited(response, MAX_RESPONSE_BYTES)
        let parsed: unknown
        try {
          parsed = JSON.parse(new TextDecoder().decode(body))
        } catch {
          throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
        }
        const image = (parsed as { data?: Array<{ b64_json?: unknown; url?: unknown }> })?.data?.[0]
        if (typeof image?.b64_json === 'string') {
          if (
            image.b64_json.length > MAX_RESPONSE_BYTES ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(image.b64_json)
          )
            throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
          const bytes = Buffer.from(image.b64_json, 'base64')
          if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
            throw new Error('IMAGE_PROVIDER_IMAGE_LIMIT')
          return new Uint8Array(bytes)
        }
        if (typeof image?.url === 'string') {
          let url: URL
          try {
            url = new URL(image.url)
          } catch {
            throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
          }
          if (url.protocol !== 'https:') throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
          const downloaded = await fetch(url.toString(), {
            redirect: 'manual',
            signal: controller.signal
          })
          if (!downloaded.ok) throw new Error(`IMAGE_DOWNLOAD_HTTP_${downloaded.status}`)
          return readLimited(downloaded, MAX_IMAGE_BYTES)
        }
        throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
        if (controller.signal.aborted) throw new Error('IMAGE_PROVIDER_TIMEOUT')
        if (error instanceof Error && /^IMAGE_[A-Z_]+(?:_\d+)?$/.test(error.message)) throw error
        throw new Error('IMAGE_PROVIDER_NETWORK_ERROR')
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
      }
    }
  }
}

export async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new Error('IMAGE_PROVIDER_IMAGE_LIMIT')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
