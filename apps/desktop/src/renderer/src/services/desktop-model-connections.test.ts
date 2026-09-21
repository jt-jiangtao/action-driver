import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from '../../../preload/desktop-api'
import type { DesktopIpcBridge } from '../../../preload/desktop-api'
import { DesktopModelConnectionsService, ModelConnectionsError } from './desktop-model-connections'

function bridge(handler: (channel: string, input: unknown) => unknown): DesktopIpcBridge {
  return {
    invoke: async (channel, input) => ({ ok: true, value: await handler(channel, input) }),
    on: () => undefined,
    off: () => undefined
  }
}

const connectionDto = {
  id: 'company-gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKeyHint: '••••1234',
  expanded: true,
  models: [{ id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'untested' }]
}

describe('DesktopModelConnectionsService', () => {
  it('maps transport DTOs into renderer domain models', async () => {
    const api = createDesktopApi(
      'darwin',
      '0.1.0',
      bridge((channel) => {
        if (channel.endsWith(':list')) return [connectionDto]
        if (channel.endsWith(':discover')) return connectionDto.models
        if (channel.endsWith(':test-models')) {
          return [{ modelId: 'qwen3.7-plus', state: 'unsupported' as const }]
        }
        return null
      })
    )
    const service = new DesktopModelConnectionsService(api.modelConnections)

    await expect(service.list()).resolves.toEqual([connectionDto])

    const draft = {
      name: '公司模型网关',
      protocol: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-secret-value'
    }
    await expect(service.discover(draft)).resolves.toEqual(connectionDto.models)
    await expect(service.testModels(draft, ['qwen3.7-plus'])).resolves.toEqual([
      { modelId: 'qwen3.7-plus', state: 'unsupported' }
    ])
  })

  it('maps Main failures into domain errors without exposing the key', async () => {
    const api = createDesktopApi('darwin', '0.1.0', {
      invoke: async () => ({
        ok: false,
        error: { code: 'unauthorized', message: 'Invalid API-key provided.' }
      }),
      on: () => undefined,
      off: () => undefined
    })
    const service = new DesktopModelConnectionsService(api.modelConnections)

    await expect(
      service.add(
        {
          name: '公司模型网关',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-secret-value'
        },
        []
      )
    ).rejects.toMatchObject({ code: 'unauthorized', message: 'Invalid API-key provided.' })
  })

  it('returns a failure result for a rejected connection test', async () => {
    const api = createDesktopApi(
      'darwin',
      '0.1.0',
      bridge(() => ({ ok: false, failure: { code: 'timeout', message: '请求超时' } }))
    )
    const service = new DesktopModelConnectionsService(api.modelConnections)

    await expect(
      service.testConnection({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    ).resolves.toEqual({ ok: false, failure: { code: 'timeout', message: '请求超时' } })
  })

  it('rejects malformed payloads instead of rendering them', async () => {
    const api = createDesktopApi('darwin', '0.1.0', bridge(() => [{ id: 'broken' }]))
    const service = new DesktopModelConnectionsService(api.modelConnections)

    await expect(service.list()).rejects.toBeInstanceOf(ModelConnectionsError)
    expect(vi.isMockFunction(service.list)).toBe(false)
  })
})
