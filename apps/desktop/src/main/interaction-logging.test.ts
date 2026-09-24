import {
  createInteractionLogRecorder,
  MemoryInteractionLogStore,
  type InteractionLogRecorder,
  type InteractionLogStore
} from '@actiondriver/observability'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMainLogging } from './logging'
import { listLogs, registerLogIpcHandlers } from './logs-ipc'

function recordingInteractions(source = 'main') {
  const store = new MemoryInteractionLogStore()
  let sequence = 0
  const interactions: InteractionLogRecorder = createInteractionLogRecorder({
    store,
    ids: {
      eventId: () => `${source}:event-${++sequence}`,
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
  it('does not create a local operational or interaction log directory', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'actiondriver-main-otel-'))
    const logging = await createMainLogging()
    const finish = await logging.interactions.start({
      transport: 'ipc', direction: 'renderer->service', operation: 'task.get',
      request: { kind: 'text', text: 'not persisted' }
    })
    await finish({ outcome: 'ok' })
    await logging.logger.close()
    expect(existsSync(join(userDataPath, 'logs'))).toBe(false)
  })
  it('does not record log control-plane channels', async () => {
    const ipcMain = ipcMainStub()
    const { interactions, store } = recordingInteractions()
    registerLogIpcHandlers(ipcMain, [], interactions)

    await ipcMain.handlers.get('actiondriver:logs:list')!(undefined, {})

    expect((await store.list({ limit: 20 })).records).toEqual([])
  })

  it('merges summary pages and routes lazy detail reads to the owning source', async () => {
    const ipcMain = ipcMainStub()
    const main = recordingInteractions()
    const service = recordingInteractions('service')
    const finishMain = await main.interactions.start({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'main-operation',
      request: { kind: 'json', value: { body: 'main request' } }
    })
    await finishMain({ outcome: 'ok', response: { kind: 'json', value: { ok: true } } })
    const finishService = await service.interactions.start({
      transport: 'http',
      direction: 'renderer->service',
      operation: 'service-operation',
      request: { kind: 'json', value: { body: 'service request' } }
    })
    await finishService({ outcome: 'ok', response: { kind: 'json', value: { ok: true } } })
    registerLogIpcHandlers(ipcMain, [
      { prefix: 'main', filePath: '/logs/main', store: async () => main.store },
      { prefix: 'service', filePath: '/logs/service', store: async () => service.store }
    ])

    const listed = (await ipcMain.handlers.get('actiondriver:logs:list')!(undefined, {
      transports: ['ipc', 'http'],
      limit: 1
    })) as { ok: true; value: { records: Array<Record<string, unknown>>; nextCursor: string } }
    expect(listed.value.records).toHaveLength(1)
    expect(listed.value.records[0]).not.toHaveProperty('request')
    expect(listed.value.nextCursor).toEqual(expect.any(String))

    const secondPage = (await ipcMain.handlers.get('actiondriver:logs:list')!(undefined, {
      transports: ['ipc', 'http'],
      cursor: listed.value.nextCursor,
      limit: 1
    })) as { ok: true; value: { records: Array<{ id: string }>; nextCursor: string | null } }
    expect(secondPage.value.records).toHaveLength(1)
    expect(secondPage.value.records[0]?.id).not.toBe(listed.value.records[0]?.id)
    expect(secondPage.value.nextCursor).toBeNull()

    const detail = (await ipcMain.handlers.get('actiondriver:logs:detail')!(undefined, {
      eventId: 'service:event-1'
    })) as { ok: true; value: { id: string; request: { text: string } } }
    expect(detail.value).toMatchObject({
      id: 'service:event-1',
      request: { text: expect.stringContaining('service request') }
    })

    await expect(
      ipcMain.handlers.get('actiondriver:logs:detail')!(undefined, { eventId: 'unknown:event-1' })
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-event-id' } })
    await expect(
      ipcMain.handlers.get('actiondriver:logs:detail')!(undefined, {
        eventId: 'service:expired-event'
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'payload-expired' } })
  })

  it('merges only one bounded page from each log source', async () => {
    const makeStore = (source: string, start: number) => {
      const list = vi.fn(
        async (query: { limit?: number; before?: { time: number; id: string } }) => ({
          records: Array.from({ length: query.limit ?? 0 }, (_, index) => ({
            id: `${source}:event-${index}`,
            correlationId: `${source}:correlation-${index}`,
            time: start - index,
            completedAt: start - index,
            transport: 'ipc' as const,
            direction: 'renderer->service' as const,
            kind: 'request-response' as const,
            state: 'completed' as const,
            operation: `${source}-operation`,
            level: 30,
            levelLabel: 'info',
            requestBytes: 0,
            responseBytes: 0,
            requestAvailable: false,
            responseAvailable: false,
            requestTruncated: false,
            responseTruncated: false
          })),
          nextCursor: 'ignored'
        })
      )
      return { list, store: { list } as unknown as InteractionLogStore }
    }
    const main = makeStore('main', 200_000)
    const service = makeStore('service', 100_000)

    const first = await listLogs(
      [
        { prefix: 'main', filePath: '/main', store: async () => main.store },
        { prefix: 'service', filePath: '/service', store: async () => service.store }
      ],
      { limit: 50 }
    )
    await listLogs(
      [
        { prefix: 'main', filePath: '/main', store: async () => main.store },
        { prefix: 'service', filePath: '/service', store: async () => service.store }
      ],
      { limit: 50, cursor: first.nextCursor }
    )

    expect(main.list).toHaveBeenCalledTimes(2)
    expect(service.list).toHaveBeenCalledTimes(2)
    expect(main.list).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: 51 }))
    expect(main.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 51, before: expect.any(Object) })
    )
  })
})
