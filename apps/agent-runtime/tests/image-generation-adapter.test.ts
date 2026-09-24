import { describe, expect, it, vi } from 'vitest'
import { createImageGenerationAdapter } from '../src/media/image-generation-adapter'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
  'base64'
)

describe('Images API adapter', () => {
  it('sends one request with n:1 and returns decoded bytes', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/images/generations')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const adapter = createImageGenerationAdapter({ fetch })
    const bytes = await adapter.generate({
      baseUrl: 'https://images.example/v1',
      apiKey: 'secret',
      modelId: 'img',
      prompt: 'a cat'
    })
    expect(bytes).toEqual(new Uint8Array(png))
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![0]).toBe('https://images.example/v1/images/generations')
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      model: 'img',
      prompt: 'a cat',
      n: 1,
      response_format: 'b64_json'
    })
  })

  it('returns stable errors without provider response or URL', async () => {
    const fetch = vi.fn(async () => new Response('secret provider response', { status: 429 }))
    const adapter = createImageGenerationAdapter({ fetch })
    await expect(
      adapter.generate({
        baseUrl: 'https://secret.example/v1',
        apiKey: 'secret',
        modelId: 'img',
        prompt: 'a cat'
      })
    ).rejects.toThrow('IMAGE_PROVIDER_HTTP_429')
  })
})
