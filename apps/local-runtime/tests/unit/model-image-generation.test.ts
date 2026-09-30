import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createService, draft, validPng, probePng, cipher } from './model-connection-fixtures'

describe('model connection service', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unsupported', { status: 400 }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tests both image endpoints for a configured Token Plan model and keeps each result', async () => {
    const imageRequests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        imageRequests.push(url)
        if (url.endsWith('/images/generations')) return new Response('url error', { status: 400 })
        if (url.endsWith('/multimodal-generation/generation'))
          return new Response(
            JSON.stringify({
              output: {
                choices: [
                  { message: { content: [{ image: 'https://cdn.example.test/image.png' }] } }
                ]
              }
            })
          )
        return new Response(new Uint8Array(probePng))
      })
    )
    const { service } = createService(() => ({ status: 400, body: {}, text: '' }))
    const [result] = await service.testModels({
      draft: { ...draft, baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' },
      modelIds: ['wan2.7-image']
    })
    expect(result?.imageEndpointVerification?.results['openai-images'].state).toBe('failed')
    expect(result?.imageEndpointVerification?.results['token-plan']).toEqual({
      state: 'success',
      testedAt: expect.any(String)
    })
    expect(result?.imageEndpointVerification?.selectedApi).toBe('token-plan')
    expect(result?.capabilities?.image_generation?.state).toBe('success')
    expect(imageRequests).toEqual([
      'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1/images/generations',
      'https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',
      'https://cdn.example.test/image.png'
    ])
  })

  it('replaces old image endpoint evidence when a saved Token Plan model is retested', async () => {
    const { service } = createService(() => ({ status: 400, body: {}, text: '' }))
    const created = await service.add({
      draft: { ...draft, baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' },
      models: [
        {
          id: 'wan2.7-image',
          name: 'wan2.7-image',
          enabled: true,
          testState: 'success',
          capabilities: { image_generation: { state: 'success', source: 'probe' } },
          imageEndpointVerification: {
            selectedApi: 'token-plan',
            results: {
              'openai-images': { state: 'failed', testedAt: '2026-09-29T00:00:00Z' },
              'token-plan': { state: 'success', testedAt: '2026-09-29T00:00:00Z' }
            }
          }
        }
      ]
    })
    await service.testConnectionModels({ connectionId: created.id, modelIds: ['wan2.7-image'] })
    const saved = (await service.list())[0]?.models[0]
    expect(saved?.imageEndpointVerification?.selectedApi).toBeNull()
    expect(saved?.imageEndpointVerification?.results['token-plan'].state).toBe('failed')
    expect(saved?.capabilities?.image_generation?.state).toBe('failed')
    await expect(
      service.setDefaultImageModel({ connectionId: created.id, modelId: 'wan2.7-image' })
    ).rejects.toThrow('Image model is unavailable')
  })

  it('does not expose a legacy Token Plan image default before endpoint verification', async () => {
    const { service, store } = createService(() => ({ status: 500, body: {}, text: '' }))
    const created = await service.add({
      draft: { ...draft, baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' },
      models: [
        {
          id: 'wan2.7-image',
          name: 'wan2.7-image',
          enabled: true,
          testState: 'success',
          capabilities: { image_generation: { state: 'success', source: 'probe' } }
        }
      ]
    })
    const model = { connectionId: created.id, modelId: 'wan2.7-image' }
    expect((await service.list())[0]?.models[0]?.capabilities?.image_generation?.state).toBe(
      'untested'
    )
    await expect(service.setDefaultImageModel(model)).rejects.toThrow('Image model is unavailable')
    store.writeDefaultImageModel(model)
    expect(await service.getDefaultImageModel()).toBeNull()
    await expect(service.generateImage({ model, prompt: 'cat' })).rejects.toThrow()
  })

  it('does not expose an image default from a legacy Anthropic connection', async () => {
    const { service, store } = createService(() => ({ status: 500, body: {}, text: '' }))
    store.write([
      {
        id: 'legacy-anthropic',
        name: 'Legacy Anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://example.com',
        apiKeyCipher: cipher.encrypt('secret'),
        apiKeyHint: 'secret',
        expanded: true,
        models: [
          {
            id: 'image-model',
            name: 'image-model',
            enabled: true,
            testState: 'success',
            capabilities: { image_generation: { state: 'success', source: 'probe' } }
          }
        ]
      }
    ])
    store.writeDefaultImageModel({ connectionId: 'legacy-anthropic', modelId: 'image-model' })
    expect(await service.getDefaultImageModel()).toBeNull()
  })

  it('does not trust endpoint evidence supplied only by the add request', async () => {
    const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
    const created = await service.add({
      draft: { ...draft, baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' },
      models: [
        {
          id: 'wan2.7-image',
          name: 'wan2.7-image',
          enabled: true,
          testState: 'success',
          capabilities: { image_generation: { state: 'success', source: 'probe' } },
          imageEndpointVerification: {
            selectedApi: 'token-plan',
            results: {
              'openai-images': { state: 'failed', testedAt: '2026-09-30T00:00:00Z' },
              'token-plan': { state: 'success', testedAt: '2026-09-30T00:00:00Z' }
            }
          }
        }
      ]
    })
    await expect(
      service.setDefaultImageModel({ connectionId: created.id, modelId: 'wan2.7-image' })
    ).rejects.toThrow('Image model is unavailable')
  })

  it('carries a real draft endpoint test into the saved connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/images/generations')) return new Response('unsupported', { status: 400 })
        if (url.endsWith('/multimodal-generation/generation'))
          return new Response(
            JSON.stringify({
              output: {
                choices: [
                  { message: { content: [{ image: 'https://cdn.example.test/image.png' }] } }
                ]
              }
            })
          )
        return new Response(new Uint8Array(probePng))
      })
    )
    const { service } = createService(() => ({ status: 400, body: {}, text: '' }))
    const tokenDraft = {
      ...draft,
      baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1'
    }
    const [tested] = await service.testModels({ draft: tokenDraft, modelIds: ['wan2.7-image'] })
    const created = await service.add({
      draft: tokenDraft,
      models: [
        {
          id: 'wan2.7-image',
          name: 'wan2.7-image',
          enabled: true,
          testState: tested!.state,
          capabilities: tested!.capabilities,
          imageEndpointVerification: tested!.imageEndpointVerification
        }
      ]
    })
    expect(created.models[0]?.imageEndpointVerification?.selectedApi).toBe('token-plan')
    await expect(
      service.setDefaultImageModel({ connectionId: created.id, modelId: 'wan2.7-image' })
    ).resolves.toBeUndefined()
  })

  it('uses the Token Plan endpoint when both endpoints are verified, without runtime fallback', async () => {
    const imageRequests: string[] = []
    let generationShouldFail = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        imageRequests.push(url)
        if (generationShouldFail) return new Response('provider failed', { status: 500 })
        if (url.endsWith('/images/generations'))
          return new Response(JSON.stringify({ data: [{ b64_json: probePng.toString('base64') }] }))
        if (url.endsWith('/multimodal-generation/generation'))
          return new Response(
            JSON.stringify({
              output: {
                choices: [
                  { message: { content: [{ image: 'https://cdn.example.test/image.png' }] } }
                ]
              }
            })
          )
        return new Response(new Uint8Array(probePng))
      })
    )
    const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
    const created = await service.add({
      draft: { ...draft, baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' },
      models: [{ id: 'wan2.7-image', name: 'wan2.7-image', enabled: true, testState: 'untested' }]
    })
    const model = { connectionId: created.id, modelId: 'wan2.7-image' }
    await service.testConnectionModels({ connectionId: created.id, modelIds: ['wan2.7-image'] })
    expect((await service.list())[0]?.models[0]?.imageEndpointVerification?.selectedApi).toBe(
      'token-plan'
    )
    await service.setDefaultImageModel(model)
    generationShouldFail = true
    await expect(service.generateImage({ model, prompt: 'cat' })).rejects.toThrow(
      'IMAGE_PROVIDER_HTTP_500'
    )
    expect(imageRequests.slice(-1)).toEqual([
      'https://token-plan.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'
    ])
  })

  it('uses the compatible Images API when it is the only verified endpoint', async () => {
    const imageRequests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        imageRequests.push(url)
        return url.endsWith('/images/generations')
          ? new Response(JSON.stringify({ data: [{ b64_json: probePng.toString('base64') }] }))
          : new Response('unsupported', { status: 400 })
      })
    )
    const { service } = createService(() => ({ status: 400, body: {}, text: '' }))
    const created = await service.add({
      draft: { ...draft, baseUrl: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1' },
      models: [
        {
          id: 'qwen-image-3.0-pro',
          name: 'qwen-image-3.0-pro',
          enabled: true,
          testState: 'untested'
        }
      ]
    })
    const model = { connectionId: created.id, modelId: 'qwen-image-3.0-pro' }
    await service.testConnectionModels({ connectionId: created.id, modelIds: [model.modelId] })
    expect((await service.list())[0]?.models[0]?.imageEndpointVerification?.selectedApi).toBe(
      'openai-images'
    )
    await service.setDefaultImageModel(model)
    expect(await service.generateImage({ model, prompt: 'cat' })).toEqual(new Uint8Array(probePng))
    expect(imageRequests.slice(-1)).toEqual([
      'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1/images/generations'
    ])
  })

  it('uses a verified image capability even when the legacy model kind is chat', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (!url.endsWith('/images/generations')) throw new Error('Wrong image endpoint')
      return new Response(JSON.stringify({ data: [{ b64_json: validPng.toString('base64') }] }), {
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetch)
    try {
      const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
      const connection = await service.add({
        draft,
        models: [
          {
            id: 'dual-model',
            name: 'dual-model',
            enabled: true,
            testState: 'success',
            kind: 'chat',
            capabilities: {
              image_generation: { state: 'success', source: 'probe' }
            }
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'dual-model' }
      await service.setDefaultImageModel(model)
      expect(await service.generateImage({ model, prompt: 'cat' })).toEqual(
        new Uint8Array(validPng)
      )
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects an in-flight image result after the default model is disabled', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        })
    )
    vi.stubGlobal('fetch', fetch)
    try {
      const { service } = createService(() => ({ status: 500, body: {}, text: '' }))
      const connection = await service.add({
        draft,
        models: [
          {
            id: 'image-model',
            name: 'image-model',
            enabled: true,
            testState: 'success',
            capabilities: { image_generation: { state: 'success', source: 'probe' } }
          }
        ]
      })
      const model = { connectionId: connection.id, modelId: 'image-model' }
      await service.setDefaultImageModel(model)
      const pending = service.generateImage({ model, prompt: 'cat' })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
      await service.setModelEnabled({ ...model, enabled: false })
      expect(await service.getDefaultImageModel()).toBeNull()
      resolveResponse?.(
        new Response(
          JSON.stringify({
            data: [{ b64_json: validPng.toString('base64') }]
          }),
          { status: 200 }
        )
      )
      await expect(pending).rejects.toThrow('Default image model changed')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a chat model as the default image model', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const connection = await service.add({
      draft,
      models: [{ id: 'chat', name: 'chat', kind: 'chat', enabled: true, testState: 'success' }]
    })
    await expect(
      service.setDefaultImageModel({ connectionId: connection.id, modelId: 'chat' })
    ).rejects.toThrow('Image model is unavailable')
  })
})
