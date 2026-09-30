import { describe, expect, it, vi } from 'vitest'
import {
  createTokenPlanImageGenerationAdapter,
  isTokenPlanBaseUrl
} from '../../src/media/token-plan-image-generation-adapter'
import { MAX_IMAGE_BYTES } from '../../src/media/session-asset-store'

const baseUrl = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const request = { baseUrl, apiKey: 'secret', modelId: 'wan2.7-image', prompt: '画一只猫' }
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
  'base64'
)
const result = (url: string) =>
  new Response(
    JSON.stringify({ output: { choices: [{ message: { content: [{ image: url }] } }] } })
  )

describe('Token Plan image generation adapter', () => {
  it('accepts the configured Token Plan gateway without trusting lookalike hosts', () => {
    expect(isTokenPlanBaseUrl('https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1')).toBe(
      true
    )
    expect(
      isTokenPlanBaseUrl('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
    ).toBe(true)
    expect(isTokenPlanBaseUrl('https://token-plan.maas.qianwenaiapi.com.evil.test/v1')).toBe(false)
    expect(isTokenPlanBaseUrl('http://token-plan.maas.qianwenaiapi.com/v1')).toBe(false)
  })

  it('uses the multimodal endpoint and downloads the returned image', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) {
        expect(url).toBe(
          'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
        )
        expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' })
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'wan2.7-image',
          input: { messages: [{ role: 'user', content: [{ text: '画一只猫' }] }] },
          parameters: { size: '1024*1024', n: 1 }
        })
        return result('https://cdn.example/image.png')
      }
      expect(url).toBe('https://cdn.example/image.png')
      expect(init?.redirect).toBe('manual')
      return new Response(new Uint8Array(png))
    })
    const bytes = await createTokenPlanImageGenerationAdapter({ fetch }).generate(request)
    expect(bytes).toEqual(new Uint8Array(png))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      name: 'provider rejection',
      response: new Response('private provider response', { status: 429 }),
      code: 'IMAGE_PROVIDER_HTTP_429'
    },
    {
      name: 'missing image',
      response: new Response(JSON.stringify({ output: { choices: [] } })),
      code: 'IMAGE_PROVIDER_RESPONSE_INVALID'
    },
    {
      name: 'insecure image URL',
      response: result('http://private.example/image.png'),
      code: 'IMAGE_PROVIDER_RESPONSE_INVALID'
    }
  ])('returns a stable error for $name', async ({ response, code }) => {
    const fetch = vi.fn(async () => response)
    await expect(
      createTokenPlanImageGenerationAdapter({ fetch }).generate(request)
    ).rejects.toThrow(code)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports image download failure without revealing the temporary URL', async () => {
    const fetch = vi.fn(async () =>
      fetch.mock.calls.length === 1
        ? result('https://secret.example/private.png')
        : new Response('expired', { status: 404 })
    )
    await expect(
      createTokenPlanImageGenerationAdapter({ fetch }).generate(request)
    ).rejects.toThrow('IMAGE_DOWNLOAD_HTTP_404')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects a download larger than the asset limit', async () => {
    const fetch = vi.fn(async () =>
      fetch.mock.calls.length === 1
        ? result('https://cdn.example/large.png')
        : new Response(new Uint8Array(MAX_IMAGE_BYTES + 1))
    )
    await expect(
      createTokenPlanImageGenerationAdapter({ fetch }).generate(request)
    ).rejects.toThrow('IMAGE_PROVIDER_IMAGE_LIMIT')
  })

  it('cancels a provider request when the caller aborts', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          })
        })
    )
    const pending = createTokenPlanImageGenerationAdapter({ fetch }).generate(
      request,
      controller.signal
    )
    controller.abort(new Error('cancelled by user'))
    await expect(pending).rejects.toThrow('cancelled by user')
  })

  it('times out a stalled provider request', async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          })
        })
    )
    await expect(
      createTokenPlanImageGenerationAdapter({ fetch, timeoutMs: 5 }).generate(request)
    ).rejects.toThrow('IMAGE_PROVIDER_TIMEOUT')
  })
})
