import type { InteractionLogger, InteractionRecord, InteractionStart } from '@actiondriver/observability'
import { describe, expect, it } from 'vitest'
import { registerAgentIpcHandlers } from './agent-ipc'
import { registerModelIpcHandlers } from './model-ipc'
import { ModelConnectionService } from './model-connections/model-connection-service'

type Recorded = { start: InteractionStart; result?: Parameters<ReturnType<InteractionLogger['start']>>[0] }

function recordingInteractions() {
  const recorded: Recorded[] = []
  const interactions: InteractionLogger = {
    start(entry) {
      const entry_ = { start: entry } as Recorded
      recorded.push(entry_)
      return (result) => {
        entry_.result = result
        return { ...entry, ...result, durationMs: 0 } as unknown as InteractionRecord
      }
    },
    record(entry, result) {
      recorded.push({ start: entry, result })
      return { ...entry, ...result, durationMs: 0 } as unknown as InteractionRecord
    }
  }
  return { interactions, recorded }
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
  it('records every agent channel with its outcome', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, recorded } = recordingInteractions()
    registerAgentIpcHandlers(
      ipcMain as never,
      {
        request: async () => ({ taskId: 'task-1' }),
        subscribeEvents: async () => ({ subscriptionId: 's-1', cursor: 0 })
      } as never,
      interactions
    )

    await ipcMain.handlers.get('actiondriver:agent:submit')!(undefined, { goal: '预订酒店' })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]!.start).toMatchObject({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'actiondriver:agent:submit'
    })
    expect(recorded[0]!.result?.outcome).toBe('ok')
  })

  it('records failures with the serialized error code', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, recorded } = recordingInteractions()
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

    expect(recorded[0]!.result).toMatchObject({
      outcome: 'error',
      error: { code: 'UNKNOWN', message: 'runtime offline' }
    })
  })

  it('records model connection channels without logging the api key', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, recorded } = recordingInteractions()
    const service = new ModelConnectionService({
      store: { read: () => [], write: () => undefined },
      cipher: { isAvailable: () => true, encrypt: (value) => value, decrypt: (value) => value },
      transport: { request: async () => ({ status: 200, body: {}, text: '' }) }
    })
    registerModelIpcHandlers(ipcMain as never, service, interactions)

    await ipcMain.handlers.get('actiondriver:model-connections:list')!(undefined, {})
    await ipcMain.handlers.get('actiondriver:model-connections:test-connection')!(undefined, {
      name: '公司模型网关',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-secret-value'
    })

    expect(recorded.map((entry) => entry.start.operation)).toEqual([
      'actiondriver:model-connections:list',
      'actiondriver:model-connections:test-connection'
    ])
    expect(JSON.stringify(recorded)).not.toContain('sk-secret-value')
  })
})
