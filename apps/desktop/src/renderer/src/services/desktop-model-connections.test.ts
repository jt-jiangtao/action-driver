import { describe, expect, it } from 'vitest'
import type { ModelConnectionsDesktopApi } from '../../../preload/desktop-api'
import { DesktopModelConnectionsService, ModelConnectionsError } from './desktop-model-connections'

const connection = {
  id: 'company-gateway', name: '公司模型网关', protocol: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1', apiKeyHint: '••••1234', expanded: true,
  models: [{ id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true,
    testState: 'untested' as const }]
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
    add: async () => connection,
    delete: async () => undefined,
    ...overrides
  }
}

const draft = {
  name: '公司模型网关', protocol: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret-value'
}

describe('DesktopModelConnectionsService', () => {
  it('maps Runtime DTOs into renderer models', async () => {
    const service = new DesktopModelConnectionsService(api())
    await expect(service.list()).resolves.toEqual([connection])
    await expect(service.discover(draft)).resolves.toEqual(connection.models)
    await expect(service.testModels(draft, ['qwen3.7-plus'])).resolves.toEqual([
      { modelId: 'qwen3.7-plus', state: 'unsupported' }
    ])
  })

  it('keeps Runtime failures visible without printing a credential', async () => {
    const service = new DesktopModelConnectionsService(api({
      add: async () => { throw { code: 'unauthorized', message: 'Invalid API-key provided.' } }
    }))
    await expect(service.add(draft, [])).rejects.toMatchObject({
      code: 'unauthorized', message: 'Invalid API-key provided.'
    })
  })

  it('returns a rejected connection test as a result', async () => {
    const service = new DesktopModelConnectionsService(api({
      testConnection: async () => ({ ok: false, failure: { code: 'timeout', message: '请求超时' } })
    }))
    await expect(service.testConnection(draft)).resolves.toEqual({
      ok: false, failure: { code: 'timeout', message: '请求超时' }
    })
  })

  it('rejects malformed Runtime payloads', async () => {
    const service = new DesktopModelConnectionsService(api({
      list: async () => [{ id: 'broken' }] as never
    }))
    await expect(service.list()).rejects.toBeInstanceOf(ModelConnectionsError)
  })
})
