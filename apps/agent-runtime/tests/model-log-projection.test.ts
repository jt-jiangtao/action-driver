import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SqliteRuntimeRepositories,
  buildModelLogSessionProjection,
  buildTaskProjection,
  openRuntimeDatabase,
  type PersistedModelCall,
  type RuntimeTaskRecord
} from '../src/index'

const model = { connectionId: 'connection-1', modelId: 'gpt-real' }

function task(id: string, status: string, error: unknown = null): RuntimeTaskRecord {
  return {
    id,
    threadId: id,
    goal: id === 'task-success' ? 'Summarize the report' : 'Fail safely',
    model,
    status,
    error,
    lastCheckpointId: null,
    createdAt: '2026-09-23T01:00:00.000Z',
    updatedAt: '2026-09-23T01:00:02.000Z'
  }
}

function call(
  taskId: string,
  status: PersistedModelCall['status'],
  response: unknown,
  error: unknown
): PersistedModelCall {
  return {
    id: `call-${taskId}`,
    taskId,
    requestId: `plan:${taskId}`,
    correlationId: `correlation-${taskId}`,
    model,
    status,
    request: {
      model: 'gpt-real',
      messages: [
        { role: 'system', content: 'Be concise.' },
        {
          role: 'user',
          content: taskId === 'task-success' ? 'Summarize the report' : 'Fail safely'
        }
      ],
      stream: false
    },
    response,
    error,
    startedAt: '2026-09-23T01:00:00.000Z',
    completedAt: '2026-09-23T01:00:02.000Z'
  }
}

describe('repository-backed task and model-log projections', () => {
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
    await first.modelCalls.save(
      call(
        completed.id,
        'completed',
        { choices: [{ message: { content: 'Short summary' } }] },
        null
      )
    )
    await first.modelCalls.save(
      call(failed.id, 'failed', null, {
        code: 'provider-error',
        message: 'upstream unavailable',
        retryable: true
      })
    )
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

    const completedLog = buildModelLogSessionProjection(
      completed,
      await reopened.messages.listByTask(completed.id),
      await reopened.modelCalls.listByTask(completed.id)
    )
    expect(completedLog.tasks[0]?.calls[0]?.sections.map((section) => section.id)).toEqual([
      'system-prompt',
      'user-input',
      'model-request',
      'model-response',
      'metadata'
    ])
    expect(completedLog.tasks[0]?.calls[0]).toMatchObject({
      requestId: 'plan:task-success',
      correlationId: 'correlation-task-success',
      status: 'completed'
    })

    const failedLog = buildModelLogSessionProjection(
      failed,
      await reopened.messages.listByTask(failed.id),
      await reopened.modelCalls.listByTask(failed.id)
    )
    expect(failedLog.tasks[0]?.calls[0]?.sections.map((section) => section.id)).toEqual([
      'system-prompt',
      'user-input',
      'model-request',
      'metadata'
    ])
    expect(failedLog.tasks[0]?.calls[0]).toMatchObject({
      status: 'failed',
      sections: [
        {},
        {},
        {},
        { id: 'metadata', content: expect.stringContaining('upstream unavailable') }
      ]
    })
    reopened.close()
  })
})
