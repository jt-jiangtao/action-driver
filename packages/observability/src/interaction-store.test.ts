import { describe, expect, it } from 'vitest'
import {
  MemoryInteractionLogStore,
  createInteractionLogRecorder,
  type InteractionLogIdFactory
} from './interaction-store'

function sequentialIds(source = 'main'): InteractionLogIdFactory {
  let event = 0
  let correlation = 0
  return {
    eventId: () => `${source}:${++event}`,
    correlationId: () => `correlation:${++correlation}`
  }
}

describe('structured interaction logs', () => {
  it('serializes begin and completion into one correlated event', async () => {
    const store = new MemoryInteractionLogStore()
    let now = 1_000
    const recorder = createInteractionLogRecorder({
      store,
      ids: sequentialIds(),
      clock: () => now
    })
    const finish = await recorder.start({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'actiondriver:agent:submit',
      request: { kind: 'json', value: { goal: 'summarise' } }
    })

    now = 1_025
    await finish({
      outcome: 'ok',
      response: { kind: 'json', value: { taskId: 'task-1' } }
    })

    const page = await store.list({ limit: 20 })
    expect(page.records).toHaveLength(1)
    expect(page.records[0]).toMatchObject({
      id: 'main:1',
      correlationId: 'correlation:1',
      state: 'completed',
      kind: 'request-response',
      durationMs: 25,
      requestAvailable: true,
      responseAvailable: true,
      requestBytes: 25,
      responseBytes: 24
    })
    expect(await store.getDetail('main:1')).toMatchObject({
      request: { kind: 'json', text: '{\n  "goal": "summarise"\n}' },
      response: { kind: 'json', text: '{\n  "taskId": "task-1"\n}' }
    })
  })

  it('recovers pending events as incomplete without inventing a response', async () => {
    const store = new MemoryInteractionLogStore()
    const recorder = createInteractionLogRecorder({
      store,
      ids: sequentialIds(),
      clock: () => 1_000
    })
    await recorder.start({
      transport: 'http',
      direction: 'renderer->service',
      operation: 'POST /tasks',
      request: { kind: 'text', text: 'start' }
    })

    expect(await store.recoverIncomplete(1_001)).toBe(1)
    expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
      state: 'incomplete',
      requestAvailable: true,
      responseAvailable: false
    })
    expect((await store.getDetail('main:1'))?.response).toBeNull()
  })

  it('records one-way websocket events without a fake response', async () => {
    const store = new MemoryInteractionLogStore()
    const recorder = createInteractionLogRecorder({
      store,
      ids: sequentialIds('service'),
      clock: () => 2_000
    })

    await recorder.recordOneWay({
      transport: 'websocket',
      direction: 'service->renderer',
      operation: 'task.event',
      taskId: 'task-1',
      payload: { kind: 'json', value: { cursor: 4 } }
    })

    expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
      id: 'service:1',
      kind: 'one-way-event',
      state: 'completed',
      requestAvailable: true,
      responseAvailable: false
    })
  })

  it('filters by transport and returns stable newest-first cursor pages', async () => {
    const store = new MemoryInteractionLogStore()
    const ids = sequentialIds()
    let now = 1_000
    const recorder = createInteractionLogRecorder({ store, ids, clock: () => now })
    for (const transport of ['ipc', 'http', 'ipc'] as const) {
      const finish = await recorder.start({
        transport,
        direction: 'renderer->service',
        operation: `${transport}-${now}`,
        request: { kind: 'empty' }
      })
      await finish({ outcome: 'ok', response: { kind: 'empty' } })
      now += 1
    }

    const first = await store.list({ transports: ['ipc'], limit: 1 })
    const second = await store.list({ transports: ['ipc'], limit: 1, cursor: first.nextCursor })
    expect(first.records.map((record) => record.operation)).toEqual(['ipc-1002'])
    expect(second.records.map((record) => record.operation)).toEqual(['ipc-1000'])
    expect(second.nextCursor).toBeNull()
  })
})
