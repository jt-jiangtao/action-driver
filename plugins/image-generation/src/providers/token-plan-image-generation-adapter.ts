import { readLimited, type ImageGenerationRequest } from './image-generation-adapter'
import { MAX_IMAGE_BYTES } from '@actiondriver/plugin-sdk'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const MAX_RESPONSE_BYTES = 1024 * 1024

export function isTokenPlanBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.maas.aliyuncs.com')
  } catch {
    return false
  }
}

export function createTokenPlanImageGenerationAdapter(
  options: { fetch?: FetchLike; timeoutMs?: number } = {}
) {
  const fetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 120_000
  return {
    async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<Uint8Array> {
      if (!isTokenPlanBaseUrl(request.baseUrl)) throw new Error('IMAGE_PROVIDER_URL_INVALID')
      const controller = new AbortController()
      const onAbort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      const timeout = setTimeout(
        () => controller.abort(new Error('IMAGE_PROVIDER_TIMEOUT')),
        timeoutMs
      )
      try {
        const endpoint = new URL(GENERATION_PATH, request.baseUrl)
        const response = await fetch(endpoint.toString(), {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${request.apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: request.modelId,
            input: { messages: [{ role: 'user', content: [{ text: request.prompt }] }] },
            parameters: { size: '1024*1024', n: 1 }
          })
        })
        if (!response.ok) throw new Error(`IMAGE_PROVIDER_HTTP_${response.status}`)
        const raw = await readLimited(response, MAX_RESPONSE_BYTES)
        let parsed: unknown
        try {
          parsed = JSON.parse(new TextDecoder().decode(raw))
        } catch {
          throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
        }
        const urlValue = findImageUrl(parsed)
        if (!urlValue) throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
        let imageUrl: URL
        try {
          imageUrl = new URL(urlValue)
        } catch {
          throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
        }
        if (imageUrl.protocol !== 'https:') throw new Error('IMAGE_PROVIDER_RESPONSE_INVALID')
        const downloaded = await fetch(imageUrl.toString(), {
          redirect: 'manual',
          signal: controller.signal
        })
        if (!downloaded.ok) throw new Error(`IMAGE_DOWNLOAD_HTTP_${downloaded.status}`)
        return await readLimited(downloaded, MAX_IMAGE_BYTES)
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

function findImageUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const output = (value as { output?: unknown }).output
  if (!output || typeof output !== 'object') return null
  const choices = (output as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return null
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue
    const message = (choice as { message?: unknown }).message
    if (!message || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { image?: unknown }).image === 'string'
      )
        return (item as { image: string }).image
    }
  }
  return null
}
