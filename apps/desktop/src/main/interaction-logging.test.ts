import {
  createInteractionLogRecorder,
  MemoryInteractionLogStore,
  type InteractionLogRecorder
} from '@actiondriver/observability'
import { ModelConnectionService } from '@actiondriver/model-connections'
import { describe, expect, it } from 'vitest'
import { registerAgentIpcHandlers } from './agent-ipc'
import { registerLogIpcHandlers } from './logs-ipc'
import { registerModelIpcHandlers } from './model-ipc'

function recordingInteractions() {
  const store = new MemoryInteractionLogStore()
  let sequence = 0
  const interactions: InteractionLogRecorder = createInteractionLogRecorder({
    store,
    ids: {
      eventId: () => `main:event-${++sequence}`,
      correlationId: () => `correlation-${sequence}`
    },
    clock: () => 1_000 + sequence
  })
  return { interactions, store }
}

function ipcMainStub() {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  return {
    handlers,
    handle(channel: string, handler: (event: unknown, input: unknown) => unknown) {
      handlers.set(channel, handler)
    }
  }
}

describe('renderer to service interaction logging', () => {
  it('records an agent request and response as one interaction', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, store } = recordingInteractions()
    registerAgentIpcHandlers(
      ipcMain as never,
      {
        request: async () => ({ taskId: 'task-1' }),
        subscribeEvents: async () => ({ subscriptionId: 's-1', cursor: 0 })
      } as never,
      interactions
    )

    await ipcMain.handlers.get('actiondriver:agent:submit')!(undefined, { goal: '预订酒店' })

    const records = (await store.list({ limit: 20 })).records
    expect(records).toHaveLength(1)
    await expect(store.getDetail(records[0]!.id)).resolves.toMatchObject({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'actiondriver:agent:submit',
      state: 'completed',
      request: { text: expect.stringContaining('预订酒店') },
      response: { text: expect.stringContaining('task-1') }
    })
  })

  it('records failures with the serialized error code', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, store } = recordingInteractions()
    registerAgentIpcHandlers(
      ipcMain as never,
      {
        request: async () => {
          throw new Error('runtime offline')
        },
        subscribeEvents: async () => ({ subscriptionId: 's-1', cursor: 0 })
      } as never,
      interactions
    )

    await ipcMain.handlers.get('actiondriver:agent:get')!(undefined, { taskId: 'task-1' })

    expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
      outcome: 'error',
      errorCode: 'UNKNOWN',
      errorMessage: 'runtime offline'
    })
  })

  it('records model connection bodies without persisting the api key', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, store } = recordingInteractions()
    const service = new ModelConnectionService({
      store: { read: () => [], write: () => undefined },
      cipher: { isAvailable: () => true, encrypt: (value) => value, decrypt: (value) => value },
      transport: { request: async () => ({ status: 200, body: {}, text: '' }) }
    })
    registerModelIpcHandlers(ipcMain as never, service, interactions)

    await ipcMain.handlers.get('actiondriver:model-connections:test-connection')!(undefined, {
      name: '公司模型网关',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-secret-value'
    })

    const record = (await store.list({ limit: 20 })).records[0]!
    const detail = await store.getDetail(record.id)
    expect(detail?.request?.text).toContain('公司模型网关')
    expect(JSON.stringify(detail)).not.toContain('sk-secret-value')
  })

  it('does not record log control-plane channels', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, store } = recordingInteractions()
    registerLogIpcHandlers(ipcMain, [], interactions)

    await ipcMain.handlers.get('actiondriver:logs:list')!(undefined, {})

    expect((await store.list({ limit: 20 })).records).toEqual([])
  })
})
