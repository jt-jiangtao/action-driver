import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildTaskProjection,
  type RuntimeTaskRecord
} from '../../src/index'
import { RolloutSessionStore } from '../../src/rollout/session-store'

const model = { connectionId: 'connection-1', modelId: 'gpt-real' }

/** Task and message history now live in the rollout log with its SQLite projection. */
function createRolloutStore(path: string): RolloutSessionStore {
  const root = join(path, '..')
  return new RolloutSessionStore({
    sessionsRoot: root,
    statePath: join(root, 'rollout-state.sqlite'),
    historyPath: join(root, 'rollout-history.sqlite')
  })
}

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
  it('normalizes a persisted image-first assistant message without changing a user bubble', () => {
    const asset = { assetId: 'old-generated', sessionId: 'session-1', mimeType: 'image/png' as const, width: 1, height: 1, byteLength: 1, source: 'generated' as const }
    const projection = buildTaskProjection(task('task-success', 'completed'), [{
      id: 'old-image-first', taskId: 'task-success', role: 'assistant', createdAt: '2026-09-23',
      content: { parts: [{ kind: 'image', asset }, { kind: 'text', text: '说明' }] }
    }])
    expect(projection.messages[0]?.parts).toEqual([{ kind: 'image', asset }, { kind: 'text', text: '说明' }])
  })
  it('projects ordered image and text parts while preserving legacy text', () => {
    const image = {
      assetId: 'asset-1',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 2,
      height: 2,
      byteLength: 12,
      source: 'upload' as const
    }
    const projection = buildTaskProjection(task('task-success', 'completed'), [
      {
        id: 'new',
        taskId: 'task-success',
        role: 'user',
        createdAt: '2026-09-23',
        content: {
          parts: [
            { kind: 'text', text: '识别' },
            { kind: 'image', asset: image }
          ]
        }
      },
      {
        id: 'old',
        taskId: 'task-success',
        role: 'assistant',
        createdAt: '2026-09-23',
        content: { text: '旧回复' }
      }
    ])
    expect(projection.messages).toEqual([
      {
        id: 'new',
        role: 'user',
        content: '识别',
        parts: [
          { kind: 'text', text: '识别' },
          { kind: 'image', asset: image }
        ]
      },
      { id: 'old', role: 'agent', content: '旧回复' }
    ])
  })

  it('retains the persisted start time when reopening a running task', () => {
    expect(buildTaskProjection(task('task-running', 'running'), []).activityStartedAt).toBe(
      '2026-09-23T01:00:00.000Z'
    )
  })

  it('projects registered deliverables with their type, name and size', () => {
    const projection = buildTaskProjection(task('task-success', 'completed'), [], [
      {
        fileId: 'file-1',
        sessionId: 'session-1',
        taskId: 'task-success',
        name: '季度报告.pdf',
        mimeType: 'application/pdf',
        byteLength: 4096,
        kind: 'document'
      },
      {
        fileId: 'file-2',
        sessionId: 'session-1',
        taskId: 'task-success',
        name: 'chart.png',
        mimeType: 'image/png',
        byteLength: 2048,
        kind: 'image'
      }
    ])

    expect(projection.outputFiles).toEqual([
      expect.objectContaining({ fileId: 'file-1', name: '季度报告.pdf', kind: 'document' }),
      expect.objectContaining({ fileId: 'file-2', name: 'chart.png', kind: 'image' })
    ])
    expect(buildTaskProjection(task('task-success', 'completed'), []).outputFiles).toBeUndefined()
  })

  it('projects an attached document with its upload task, name, format and size', () => {
    const file = {
      fileId: 'file-1',
      sessionId: 'session-1',
      taskId: 'task-success',
      name: '季度报告.pdf',
      mimeType: 'application/pdf',
      byteLength: 4096
    }
    const projection = buildTaskProjection(task('task-success', 'completed'), [
      {
        id: 'document-user',
        taskId: 'task-success',
        role: 'user',
        createdAt: '2026-09-26T00:00:00.000Z',
        content: { parts: [{ kind: 'text', text: '总结附件' }, { kind: 'document', file }] }
      }
    ])

    expect(projection.messages).toEqual([
      {
        id: 'document-user',
        role: 'user',
        content: '总结附件',
        parts: [{ kind: 'text', text: '总结附件' }, { kind: 'document', file }]
      }
    ])
  })

  it('keeps messages written before document support readable after reopening', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'actiondriver-projection-legacy-')), 'runtime.db')
    const first = createRolloutStore(path)
    const legacy = task('task-success', 'completed')
    await first.tasks.save(legacy)
    await first.messages.save({
      id: 'legacy-user',
      taskId: legacy.id,
      role: 'user',
      content: '旧的消息',
      createdAt: legacy.createdAt
    })
    first.close()

    const reopened = createRolloutStore(path)
    const projection = buildTaskProjection(
      (await reopened.tasks.get(legacy.id))!,
      await reopened.messages.listByTask(legacy.id)
    )
    expect(projection.messages).toEqual([
      { id: 'legacy-user', role: 'user', content: '旧的消息' }
    ])
    reopened.close()
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
    const first = createRolloutStore(path)
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

    const reopened = createRolloutStore(path)
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
