import {
  createInteractionLogRecorder,
  MemoryInteractionLogStore
} from '@actiondriver/observability'
import { describe, expect, it } from 'vitest'
import { createWebSocketInteractionRecorder } from '../src/service/websocket-interaction-recorder'

describe('websocket interaction recorder adapter', () => {
  it('pairs commands and responses and records pushed events as one-way', async () => {
    const store = new MemoryInteractionLogStore()
    let sequence = 0
    const interactions = createInteractionLogRecorder({
      store,
      ids: {
        eventId: () => `service:event-${++sequence}`,
        correlationId: () => `correlation-${sequence}`
      },
      clock: () => 3_000 + sequence
    })
    const recorder = createWebSocketInteractionRecorder(interactions)

    const finish = await recorder.startCommand({
      type: 'task.submit',
      requestId: 'request-1',
      taskId: 'task-1',
      payload: { goal: '检查运行状态' }
    })
    await finish({
      type: 'task.accepted',
      requestId: 'request-1',
      taskId: 'task-1',
      payload: { accepted: true }
    })
    await recorder.recordEvent({
      type: 'task.progress',
      requestId: 'subscription-1',
      taskId: 'task-1',
      payload: { message: 'running' }
    })

    const records = (await store.list({ limit: 20 })).records
    expect(records).toHaveLength(2)
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transport: 'websocket',
          kind: 'request-response',
          requestId: 'request-1',
          taskId: 'task-1'
        }),
        expect.objectContaining({
          transport: 'websocket',
          kind: 'one-way-event',
          requestId: 'subscription-1',
          taskId: 'task-1'
        })
      ])
    )
  })
})
