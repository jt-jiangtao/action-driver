import { describe, expect, it, vi } from 'vitest'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
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
  it('emits an IPC summary without persisting request or response content', async () => {
    const emitted: Record<string, unknown>[] = []
    let now = 1_000
    const recorder = createInteractionLogRecorder({
      ids: sequentialIds(),
      clock: () => now,
      logger: {
        info: (record: Record<string, unknown>) => emitted.push(record),
        error: (record: Record<string, unknown>) => emitted.push(record)
      } as never
    })
    const finish = await recorder.start({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'task:run',
      taskId: 'task-1',
      request: { kind: 'json', value: { secretMarker: 'BODY_NEVER_IN_LOKI' } }
    })
    now = 1_025
    await finish({ outcome: 'ok', response: { kind: 'text', text: 'RESPONSE_NEVER_IN_LOKI' } })

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'task:run',
      taskId: 'task-1',
      outcome: 'ok',
      durationMs: 25
    })
    expect(JSON.stringify(emitted)).not.toMatch(/BODY_NEVER_IN_LOKI|RESPONSE_NEVER_IN_LOKI/)
  })

  it('emits one summary for a one-way WebSocket event', async () => {
    const emitted: Record<string, unknown>[] = []
    const recorder = createInteractionLogRecorder({
      ids: sequentialIds(),
      clock: () => 2_000,
      logger: {
        info: (record: Record<string, unknown>) => emitted.push(record),
        error: (record: Record<string, unknown>) => emitted.push(record)
      } as never
    })
    await recorder.recordOneWay({
      transport: 'websocket',
      direction: 'service->renderer',
      operation: 'task.progress',
      requestId: 'request-1',
      taskId: 'task-1',
      payload: { kind: 'text', text: 'STREAM_BODY_NEVER_IN_LOKI' }
    })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      transport: 'websocket',
      operation: 'task.progress',
      outcome: 'sent',
      requestId: 'request-1',
      taskId: 'task-1'
    })
    expect(JSON.stringify(emitted)).not.toContain('STREAM_BODY_NEVER_IN_LOKI')
  })

  it('correlates an IPC summary with a bounded span without adding request content', async () => {
    const emitted: Record<string, unknown>[] = []
    const setAttribute = vi.fn()
    const end = vi.fn()
    const tracer = { startSpan: vi.fn(() => ({
      spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
      setAttribute,
      setStatus: vi.fn(),
      end
    })) }
    const recorder = createInteractionLogRecorder({
      ids: sequentialIds(),
      tracer: tracer as never,
      logger: { info: (record: Record<string, unknown>) => emitted.push(record) } as never
    })
    const finish = await recorder.start({
      transport: 'ipc', direction: 'renderer->service', operation: 'task.get',
      request: { kind: 'text', text: 'NO_TRACE_PAYLOAD_MARKER' }
    })
    await finish({ outcome: 'ok' })
    expect(emitted[0]).toMatchObject({ trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) })
    expect(JSON.stringify(tracer.startSpan.mock.calls)).not.toContain('NO_TRACE_PAYLOAD_MARKER')
    expect(end).toHaveBeenCalledOnce()
  })

  it('records call count and duration with low-cardinality metric attributes', async () => {
    const add = vi.fn()
    const record = vi.fn()
    const meter = {
      createCounter: vi.fn(() => ({ add })),
      createHistogram: vi.fn(() => ({ record }))
    }
    const recorder = createInteractionLogRecorder({
      ids: sequentialIds(), meter: meter as never, clock: () => 1_000
    })
    const finish = await recorder.start({
      transport: 'http', direction: 'renderer->service', operation: 'POST /secret-path',
      request: { kind: 'text', text: 'NO_METRIC_PAYLOAD_MARKER' }
    })
    await finish({ outcome: 'error', error: { code: 'network', message: 'private details' } })
    expect(add).toHaveBeenCalledWith(1, {
      transport: 'http', direction: 'renderer->service', outcome: 'error'
    })
    expect(record).toHaveBeenCalledWith(0, {
      transport: 'http', direction: 'renderer->service', outcome: 'error'
    })
    expect(JSON.stringify(add.mock.calls)).not.toMatch(/secret-path|NO_METRIC_PAYLOAD_MARKER|private details/)
  })

  it('runs the business callback under the interaction span context', async () => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
    const span = {
      spanContext: () => ({ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), traceFlags: 1 }),
      setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn()
    }
    const recorder = createInteractionLogRecorder({
      ids: sequentialIds(), tracer: { startSpan: () => span } as never
    })
    const finish = await recorder.start({
      transport: 'ipc', direction: 'renderer->service', operation: 'task.get',
      request: { kind: 'empty' }
    })
    const traceId = await finish.run(async () => trace.getSpan(context.active())?.spanContext().traceId)
    expect(traceId).toBe('c'.repeat(32))
    await finish({ outcome: 'ok' })
    context.disable()
  })

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

  it('finds a complete interaction chain by correlation identifier', async () => {
    const store = new MemoryInteractionLogStore()
    const recorder = createInteractionLogRecorder({
      store,
      ids: sequentialIds(),
      clock: () => 1_000
    })
    const finish = await recorder.start({
      transport: 'http',
      direction: 'renderer->service',
      operation: 'POST /tasks',
      request: { kind: 'empty' }
    })
    await finish({ outcome: 'ok', response: { kind: 'empty' } })

    expect((await store.list({ search: 'correlation:1', limit: 20 })).records).toHaveLength(1)
  })

  it('keeps a caller supplied correlation id for a model interaction', async () => {
    const store = new MemoryInteractionLogStore()
    const recorder = createInteractionLogRecorder({
      store,
      ids: sequentialIds(),
      clock: () => 1_000
    })
    const finish = await recorder.start({
      correlationId: 'model-call:task-1',
      transport: 'http',
      direction: 'service->model',
      operation: 'POST /chat/completions',
      requestId: 'plan:task-1',
      taskId: 'task-1',
      request: { kind: 'json', value: { model: 'gpt-real' } }
    })
    await finish({ outcome: 'ok', response: { kind: 'json', value: { content: 'done' } } })

    expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
      correlationId: 'model-call:task-1',
      direction: 'service->model',
      requestId: 'plan:task-1',
      taskId: 'task-1'
    })
  })
})
