import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelServiceError } from '@action-driver/model-connections'
import { createService, draft, discoveredModels } from './model-connection-fixtures'

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

  it('stores a connection with an encrypted key and only exposes a hint', async () => {
    const { service, store } = createService(() => ({ status: 200, body: {}, text: '' }))

    const created = await service.add({ draft, models: discoveredModels })

    expect(created).toMatchObject({ name: '公司模型网关', apiKeyHint: '••••alue' })
    expect(JSON.stringify(created)).not.toContain('sk-secret-value')
    expect(JSON.stringify(store.read())).not.toContain('sk-secret-value')
    await expect(service.list()).resolves.toEqual([created])
  })

  it('classifies connection failures for the renderer', async () => {
    const { service } = createService((request) =>
      request.url.endsWith('/models')
        ? {
            status: 401,
            body: { code: 'InvalidApiKey', message: 'Invalid API-key provided.' },
            text: ''
          }
        : { status: 200, body: {}, text: '' }
    )

    await expect(service.testConnection(draft)).resolves.toEqual({
      ok: false,
      failure: { code: 'unauthorized', message: 'Invalid API-key provided.' }
    })
  })

  it('redacts normalized and saved credentials from provider failures', async () => {
    const { service } = createService((request) => ({
      status: 401,
      body: { message: `Rejected ${request.headers.authorization}` },
      text: ''
    }))

    const draftResult = await service.testConnection({
      ...draft,
      apiKey: '  sk-secret-value  '
    })
    expect(JSON.stringify(draftResult)).not.toContain('sk-secret-value')

    const created = await service.add({ draft, models: discoveredModels })
    await expect(service.refresh(created.id)).rejects.toMatchObject({
      message: 'Rejected [redacted]'
    })
  })

  it('discovers models and persists refreshed results for saved connections', async () => {
    const { service } = createService((request) =>
      request.url.endsWith('/models')
        ? {
            status: 200,
            body: { data: [{ id: 'qwen3.7-plus' }, { id: 'qwen3.8-max' }] },
            text: ''
          }
        : { status: 200, body: {}, text: '' }
    )

    await expect(service.discover(draft)).resolves.toEqual([
      {
        id: 'qwen3.7-plus',
        name: 'qwen3.7-plus',
        enabled: true,
        testState: 'untested',
        probeCandidates: ['text', 'reasoning', 'vision', 'image_generation'],
        chatCandidate: true
      },
      {
        id: 'qwen3.8-max',
        name: 'qwen3.8-max',
        enabled: true,
        testState: 'untested',
        probeCandidates: ['text', 'reasoning', 'vision', 'image_generation'],
        chatCandidate: true
      }
    ])

    const created = await service.add({ draft, models: discoveredModels })
    const refreshed = await service.refresh(created.id)
    expect(refreshed.map((model) => model.id)).toEqual(['qwen3.7-plus', 'qwen3.8-max'])
    expect((await service.list())[0]!.models.map((model) => model.id)).toEqual([
      'qwen3.7-plus',
      'qwen3.8-max'
    ])
  })

  it('persists enablement, deletion, and rejects unknown connections', async () => {
    const { service } = createService(() => ({ status: 200, body: {}, text: '' }))
    const created = await service.add({ draft, models: discoveredModels })

    await service.setModelEnabled({
      connectionId: created.id,
      modelId: 'qwen3.7-plus',
      enabled: false
    })
    expect((await service.list())[0]!.models[0]!.enabled).toBe(false)

    await expect(service.delete(created.id)).resolves.toBeUndefined()
    await expect(service.list()).resolves.toEqual([])

    await expect(
      service.testConnectionModels({
        connectionId: 'missing-connection',
        modelIds: ['qwen3.7-plus']
      })
    ).rejects.toBeInstanceOf(ModelServiceError)
  })

  it('rejects invalid drafts before touching the network', async () => {
    const { service, requests } = createService(() => ({ status: 200, body: {}, text: '' }))

    await expect(
      service.testConnection({ ...draft, baseUrl: 'ftp://example.com' })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(requests).toEqual([])
  })
})
