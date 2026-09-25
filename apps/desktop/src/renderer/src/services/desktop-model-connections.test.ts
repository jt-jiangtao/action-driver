import { describe, expect, it } from 'vitest'
import type { ModelConnectionsDesktopApi } from '../../../preload/desktop-api'
import { DesktopModelConnectionsService, ModelConnectionsError } from './desktop-model-connections'

const connection = {
  id: 'company-gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKeyHint: '••••1234',
  expanded: true,
  models: [
    { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'untested' as const }
  ]
}

function api(overrides: Partial<ModelConnectionsDesktopApi> = {}): ModelConnectionsDesktopApi {
  return {
    list: async () => [connection],
    testConnection: async () => ({ ok: true }),
    discover: async () => connection.models,
    refresh: async () => connection.models,
    testModels: async () => [{ modelId: 'qwen3.7-plus', state: 'unsupported' }],
    testConnectionModels: async () => [],
    setModelEnabled: async () => undefined,
    setModelKind: async () => undefined,
    setModelImageCapability: async () => undefined,
    setModelImageGenerationApi: async () => undefined,
    setDefaultImageModel: async () => undefined,
    getDefaultImageModel: async () => null,
    add: async () => connection,
    delete: async () => undefined,
    ...overrides
  }
}

const draft = {
  name: '公司模型网关',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-secret-value'
}

describe('DesktopModelConnectionsService', () => {
  it('preserves independent capability results and display-only labels', async () => {
    const capabilities = { text: { state: 'success' as const, source: 'probe' as const }, vision: { state: 'failed' as const, source: 'probe' as const, failure: { code: 'provider-error' as const, message: 'No vision' } } }
    const service = new DesktopModelConnectionsService(api({
      list: async () => [{ ...connection, models: [{ id: 'hybrid', name: 'hybrid', enabled: true, testState: 'success', capabilities, catalogLabels: ['speech_recognition'] }] }],
      testModels: async () => [{ modelId: 'hybrid', state: 'success', capabilities }]
    }))
    expect((await service.list())[0]?.models[0]).toMatchObject({ capabilities, catalogLabels: ['speech_recognition'] })
    expect((await service.testModels(draft, ['hybrid']))[0]).toMatchObject({ capabilities })
  })
  it('maps image flags and the separate default generation model', async () => {
    const model = { connectionId: 'company-gateway', modelId: 'image' }
    const service = new DesktopModelConnectionsService(
      api({
        list: async () => [
          {
            ...connection,
            models: [
              {
                id: 'image',
                name: 'image',
                enabled: true,
                testState: 'untested',
                imageInputEnabled: false,
                imageGenerationEnabled: true
              }
            ]
          }
        ],
        getDefaultImageModel: async () => model
      })
    )
    expect((await service.list())[0]?.models[0]).toMatchObject({
      imageGenerationEnabled: true,
      imageGenerationApi: 'openai-images'
    })
    expect(await service.getDefaultImageModel()).toEqual(model)
  })

  it('forwards the selected image API to the desktop bridge', async () => {
    const calls: unknown[] = []
    const service = new DesktopModelConnectionsService(
      api({
        setModelImageGenerationApi: async (...args) => {
          calls.push(args)
        }
      })
    )
    await service.setModelImageGenerationApi('company-gateway', 'qwen3.7-plus', 'token-plan')
    expect(calls).toEqual([['company-gateway', 'qwen3.7-plus', 'token-plan']])
  })

  it('maps Runtime DTOs into renderer models', async () => {
    const service = new DesktopModelConnectionsService(api())
    await expect(service.list()).resolves.toEqual([
      {
        ...connection,
        models: [{ ...connection.models[0], kind: 'chat', imageGenerationApi: 'openai-images' }]
      }
    ])
    await expect(service.discover(draft)).resolves.toEqual([
      { ...connection.models[0], kind: 'chat', imageGenerationApi: 'openai-images' }
    ])
    await expect(service.testModels(draft, ['qwen3.7-plus'])).resolves.toEqual([
      { modelId: 'qwen3.7-plus', state: 'unsupported' }
    ])
  })

  it('keeps Runtime failures visible without printing a credential', async () => {
    const service = new DesktopModelConnectionsService(
      api({
        add: async () => {
          throw { code: 'unauthorized', message: 'Invalid API-key provided.' }
        }
      })
    )
    await expect(service.add(draft, [])).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Invalid API-key provided.'
    })
  })

  it('returns a rejected connection test as a result', async () => {
    const service = new DesktopModelConnectionsService(
      api({
        testConnection: async () => ({
          ok: false,
          failure: { code: 'timeout', message: '请求超时' }
        })
      })
    )
    await expect(service.testConnection(draft)).resolves.toEqual({
      ok: false,
      failure: { code: 'timeout', message: '请求超时' }
    })
  })

  it('rejects malformed Runtime payloads', async () => {
    const service = new DesktopModelConnectionsService(
      api({
        list: async () => [{ id: 'broken' }] as never
      })
    )
    await expect(service.list()).rejects.toBeInstanceOf(ModelConnectionsError)
  })
})
