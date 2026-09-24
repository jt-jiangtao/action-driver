import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SqliteRuntimeRepositories,
  buildTaskProjection,
  openRuntimeDatabase,
  type RuntimeTaskRecord
} from '../src/index'

const model = { connectionId: 'connection-1', modelId: 'gpt-real' }

function task(id: string, status: string, error: unknown = null): RuntimeTaskRecord {
  return {
    id,
    threadId: id,
    sessionId: 'session-1',
    goal: id === 'task-success' ? 'Summarize the report' : 'Fail safely',
    model,
    status,
    error,
    lastCheckpointId: null,
    createdAt: '2026-09-23T01:00:00.000Z',
    updatedAt: '2026-09-23T01:00:02.000Z'
  }
}

describe('repository-backed task projections', () => {
  it('retains the persisted start time when reopening a running task', () => {
    expect(buildTaskProjection(task('task-running', 'running'), []).activityStartedAt).toBe(
      '2026-09-23T01:00:00.000Z'
    )
  })

  it('projects a cancelled stream as paused rather than perpetually running', () => {
    const cancelled = task('task-cancelled', 'cancelled', {
      code: 'cancelled',
      message: 'Request was cancelled',
      retryable: false
    })
    expect(buildTaskProjection(cancelled, [])).toMatchObject({
      status: 'paused',
      steps: [{ detail: '任务已暂停' }]
    })
  })
  it('projects structured text messages written by the streaming session', () => {
    const projection = buildTaskProjection(task('task-success', 'running'), [
      {
        id: 'stream-user',
        taskId: 'task-success',
        role: 'user',
        content: { text: 'Stream request' },
        createdAt: '2026-09-23T01:00:00.000Z'
      },
      {
        id: 'stream-assistant',
        taskId: 'task-success',
        role: 'assistant',
        content: { text: '' },
        createdAt: '2026-09-23T01:00:00.000Z'
      }
    ])

    expect(projection.messages).toEqual([
      { id: 'stream-user', role: 'user', content: 'Stream request' },
      { id: 'stream-assistant', role: 'agent', content: '' }
    ])
  })

  it('projects completed and failed records after reopening storage', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'actiondriver-projection-')), 'runtime.db')
    const first = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    const completed = task('task-success', 'completed')
    const failed = task('task-failed', 'failed', {
      code: 'MODEL_GATEWAY_ERROR',
      message: 'upstream unavailable'
    })
    await first.tasks.save(completed)
    await first.tasks.save(failed)
    await first.messages.save({
      id: 'message-success-user',
      taskId: completed.id,
      role: 'user',
      content: completed.goal,
      createdAt: completed.createdAt
    })
    await first.messages.save({
      id: 'message-success-agent',
      taskId: completed.id,
      role: 'assistant',
      content: 'Short summary',
      createdAt: completed.updatedAt
    })
    await first.messages.save({
      id: 'message-failed-user',
      taskId: failed.id,
      role: 'user',
      content: failed.goal,
      createdAt: failed.createdAt
    })
    first.close()

    const reopened = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    const completedProjection = buildTaskProjection(
      (await reopened.tasks.get(completed.id))!,
      await reopened.messages.listByTask(completed.id)
    )
    expect(completedProjection).toMatchObject({
      status: 'succeeded',
      browser: null,
      messages: [
        { role: 'user', content: 'Summarize the report' },
        { role: 'agent', content: 'Short summary' }
      ],
      steps: [{ state: 'success' }]
    })

    const failedProjection = buildTaskProjection(
      (await reopened.tasks.get(failed.id))!,
      await reopened.messages.listByTask(failed.id)
    )
    expect(failedProjection).toMatchObject({
      status: 'failed',
      browser: null,
      messages: [{ role: 'user', content: 'Fail safely' }],
      steps: [{ state: 'failed' }]
    })

    reopened.close()
  })
})
