import { describe, expect, it } from 'vitest'
import type { PersistedStreamRequest } from '@action-driver/agent-runtime/ports'
import { RolloutRequestIndex } from '../../../src/rollout/request-index'

function request(
  requestId: string,
  taskId: string,
  idempotencyKey: string
): PersistedStreamRequest {
  return {
    requestId,
    taskId,
    idempotencyKey,
    sessionId: 'session',
    responseId: 'response',
    streamId: 'stream',
    messageId: 'message',
    status: 'running',
    lastSequence: -1,
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z'
  }
}

describe('rollout request index', () => {
  it('returns the first inserted match for duplicate task and idempotency keys', () => {
    const first = request('first', 'task', 'key')
    const second = request('second', 'task', 'key')
    const index = new RolloutRequestIndex([first, second])
    expect(index.getByTaskId('task')).toEqual(first)
    expect(index.getByIdempotencyKey('key')).toEqual(first)
    expect([...index.values()]).toEqual([first, second])
    index.upsert({ ...first, status: 'completed' })
    expect(index.getByTaskId('task')?.status).toBe('completed')
  })

  it('removes stale keys on update and reveals the next duplicate', () => {
    const first = request('first', 'task', 'key')
    const second = request('second', 'task', 'key')
    const index = new RolloutRequestIndex([first, second])
    index.upsert({ ...first, taskId: 'other-task', idempotencyKey: 'other-key' })
    expect(index.getByTaskId('task')).toEqual(second)
    expect(index.getByIdempotencyKey('key')).toEqual(second)
    expect(index.getByTaskId('other-task')?.requestId).toBe('first')
    expect(index.getByIdempotencyKey('other-key')?.requestId).toBe('first')
    expect(index.getByRequestId('first')?.taskId).toBe('other-task')
  })
})
