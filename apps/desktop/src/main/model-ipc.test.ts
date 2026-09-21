import { describe, expect, it } from 'vitest'
import { MODEL_IPC_CHANNELS } from '../shared/model-ipc-contract'
import { registerModelIpcHandlers, serializeModelError } from './model-ipc'
import { ModelServiceError } from './model-connections/model-connection-service'
import type { ModelConnectionService } from './model-connections/model-connection-service'

function createIpcMain() {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  return {
    handlers,
    handle(channel: string, handler: (event: unknown, input: unknown) => unknown) {
      handlers.set(channel, handler)
    }
  }
}

function serviceStub(overrides: Partial<ModelConnectionService> = {}): ModelConnectionService {
  const base = {
    list: () => [],
    testConnection: async () => ({ ok: true }),
    discover: async () => [],
    refresh: async () => [],
    testModels: async () => [],
    testConnectionModels: async () => [],
    setModelEnabled: async () => undefined,
    add: async () => ({
      id: 'connection-1',
      name: '连接',
      protocol: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKeyHint: '••••1234',
      expanded: true,
      models: []
    }),
    delete: async () => undefined
  }
  return { ...base, ...overrides } as unknown as ModelConnectionService
}

describe('model connection IPC handlers', () => {
  it('registers a named handler for every whitelisted channel', () => {
    const ipcMain = createIpcMain()
    registerModelIpcHandlers(ipcMain, serviceStub())

    expect([...ipcMain.handlers.keys()].sort()).toEqual(Object.values(MODEL_IPC_CHANNELS).sort())
  })

  it('wraps results and forwards renderer input to the service', async () => {
    const ipcMain = createIpcMain()
    const calls: unknown[] = []
    registerModelIpcHandlers(
      ipcMain,
      serviceStub({
        testModels: async (request) => {
          calls.push(request)
          return [{ modelId: 'qwen3.7-plus', state: 'unsupported' }]
        }
      })
    )
    const draft = {
      name: '公司模型网关',
      protocol: 'openai-compatible' as const,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-secret-value'
    }

    const response = await ipcMain.handlers.get(MODEL_IPC_CHANNELS.testModels)!(undefined, {
      draft,
      modelIds: ['qwen3.7-plus']
    })

    expect(calls).toEqual([{ draft, modelIds: ['qwen3.7-plus'] }])
    expect(response).toEqual({
      ok: true,
      value: [{ modelId: 'qwen3.7-plus', state: 'unsupported' }]
    })
  })

  it('serializes service failures without leaking the API key', async () => {
    const ipcMain = createIpcMain()
    registerModelIpcHandlers(
      ipcMain,
      serviceStub({
        list: () => {
          throw new ModelServiceError('storage-error', 'MODEL_STORAGE_ERROR: cannot read store')
        }
      })
    )

    const response = await ipcMain.handlers.get(MODEL_IPC_CHANNELS.list)!(undefined, {})

    expect(response).toEqual({
      ok: false,
      error: { code: 'storage-error', message: 'MODEL_STORAGE_ERROR: cannot read store' }
    })
    expect(JSON.stringify(response)).not.toContain('sk-')
  })

  it('maps unknown failures to a serializable error', () => {
    expect(serializeModelError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' })
  })
})
