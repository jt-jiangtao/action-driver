import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SqliteRuntimeRepositories,
  createLocalRuntimeAdapters,
  createLocalRuntimeServer,
  createSqliteCheckpointer,
  openRuntimeDatabase,
  type ModelGateway
} from '../src/index'

function createHarness(
  modelGateway: ModelGateway,
  streamSnapshots?: {
    getTaskSnapshot(
      taskId: string
    ): Promise<Extract<StreamServerEvent, { type: 'response.snapshot' }> | null>
  }
) {
  const path = join(mkdtempSync(join(tmpdir(), 'actiondriver-server-')), 'actiondriver.db')
  const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
  const checkpointer = createSqliteCheckpointer(path)
  const local = createLocalRuntimeAdapters({ repositories, checkpointer, modelGateway })
  const server = createLocalRuntimeServer({
    adapters: local.adapters,
    messages: repositories.messages,
    ...(streamSnapshots ? { streamSnapshots } : {})
  })
  return { server, repositories, checkpointer }
}

const model = { connectionId: 'connection-1', modelId: 'gpt-real' }

describe('local Runtime server composition', () => {
  it('restores the first turn duration and activity when opening a later turn', async () => {
    let firstTaskId = ''
    const snapshots = {
      async getTaskSnapshot(taskId: string) {
        if (taskId !== firstTaskId) return null
        return {
          type: 'response.snapshot',
          taskId,
          durationMs: 5_000,
          activities: [{
            activityId: 'first-group',
            title: '测试工具',
            titleRevision: 1,
            status: 'completed',
            items: [{ id: 'tool:first', kind: 'tool', callId: 'first' }]
          }],
          activityTimeline: [{ id: 'activity:first-group', kind: 'activity', activityId: 'first-group' }],
          tools: [{
            callId: 'first', toolId: 'web.search@1', modelName: 'web_search',
            summary: '搜索网页', argumentsHash: 'hash', status: 'completed'
          }]
        } as Extract<StreamServerEvent, { type: 'response.snapshot' }>
      }
    }
    const harness = createHarness({ async complete() { return { kind: 'finish', content: '第一答' } } }, snapshots)
    const first = await harness.server.execute('task.submit', {
      goal: '测试所有工具', model, skills: []
    }) as { taskId: string }
    firstTaskId = first.taskId
    await vi.waitFor(async () => {
      await expect(harness.repositories.tasks.get(firstTaskId)).resolves.toMatchObject({ status: 'completed' })
    })
    const firstRecord = (await harness.repositories.tasks.get(firstTaskId))!
    const firstUser = (await harness.repositories.messages.listByTask(firstTaskId)).find((message) => message.role === 'user')!
    const secondStartedAt = new Date(Date.parse(firstRecord.createdAt) + 1_000).toISOString()
    const secondEndedAt = new Date(Date.parse(firstRecord.createdAt) + 2_000).toISOString()
    await harness.repositories.tasks.save({
      ...firstRecord, id: 'second-task', threadId: 'second-task', goal: '111',
      createdAt: secondStartedAt, updatedAt: secondEndedAt
    })
    await harness.repositories.messages.save({
      id: 'second-user', taskId: 'second-task', role: 'user', content: '111',
      createdAt: secondStartedAt
    })
    await harness.repositories.messages.save({
      id: 'second-answer', taskId: 'second-task', role: 'assistant', content: '第二答',
      createdAt: secondEndedAt
    })
    const { task } = await harness.server.execute('task.get', { taskId: 'second-task' }) as {
      task: { priorActivityTurns?: unknown[] }
    }
    expect(task.priorActivityTurns).toMatchObject([{
      taskId: firstTaskId,
      userMessageId: firstUser.id,
      durationMs: 5_000,
      activities: [{ activityId: 'first-group' }],
      activityTimeline: [{ activityId: 'first-group' }],
      tools: [{ callId: 'first' }]
    }])
    const { task: reopenedFirst } = await harness.server.execute('task.get', { taskId: firstTaskId }) as {
      task: { messages: Array<{ content: string }> }
    }
    expect(reopenedFirst.messages.map((message) => message.content)).not.toContain('111')
    await harness.server.close()
    harness.checkpointer.close()
    harness.repositories.close()
  })

  it('restores activity order, tool I/O and duration through task.get', async () => {
    const snapshots = {
      async getTaskSnapshot(taskId: string) {
        return {
          type: 'response.snapshot',
          taskId,
          cursor: 8,
          sequence: 3,
          durationMs: 2800,
          activities: [
            {
              activityId: 'activity',
              title: '读取文件',
              titleRevision: 2,
              status: 'completed',
              items: [
                { id: 'text:plan', kind: 'text', content: '正文 A', phase: 'process' },
                { id: 'tool:call', kind: 'tool', callId: 'call' }
              ]
            }
          ],
          activityTimeline: [{ id: 'activity:activity', kind: 'activity', activityId: 'activity' }],
          tools: [
            {
              callId: 'call',
              toolId: 'sandbox.fs.read',
              modelName: 'sandbox_fs_read',
              summary: 'README',
              argumentsHash: 'hash',
              status: 'completed',
              durationMs: 3,
              activityId: 'activity',
              rawInput: '{"path":"README.md"}',
              rawOutput: 'ok'
            }
          ]
        } as Extract<StreamServerEvent, { type: 'response.snapshot' }>
      }
    }
    const harness = createHarness(
      {
        async complete() {
          return { kind: 'finish', content: '结论' }
        }
      },
      snapshots
    )
    const { taskId } = await harness.server.execute('task.submit', {
      goal: '读取 README',
      model,
      skills: []
    }) as { taskId: string }
    await vi.waitFor(async () => {
      const { task } = await harness.server.execute('task.get', { taskId }) as { task: Record<string, unknown> }
      expect(task).toMatchObject({
        streamCursor: 8,
        streamSequence: 3,
        activityDurationMs: 2800,
        activities: [{ items: [{ content: '正文 A' }, { callId: 'call' }] }],
        tools: [{ callId: 'call', rawOutput: 'ok' }]
      })
    })
    await harness.server.close()
    harness.checkpointer.close()
    harness.repositories.close()
  })

  it('persists the real user input and assistant result', async () => {
    const harness = createHarness({
      async complete() {
        return { kind: 'finish', content: 'Real model answer' }
      }
    })
    const { taskId } = await harness.server.execute('task.submit', {
      goal: 'Book a hotel',
      model,
      skills: []
    }) as { taskId: string }

    await vi.waitFor(async () => {
      const { task } = await harness.server.execute('task.get', { taskId }) as { task: Record<string, unknown> }
      expect(task?.status).toBe('succeeded')
      expect(task?.messages).toEqual([
        expect.objectContaining({ role: 'user', content: 'Book a hotel' }),
        expect.objectContaining({ role: 'agent', content: 'Real model answer' })
      ])
    })
    await expect(harness.repositories.messages.listByTask(taskId)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Book a hotel' }),
      expect.objectContaining({ role: 'assistant', content: 'Real model answer' })
    ])
    await expect(harness.server.execute('task.list', { limit: 100 })).resolves.toMatchObject({
      tasks: [
        {
          id: taskId,
          sessionId: taskId,
          model,
          status: 'succeeded'
        }
      ]
    })
    await harness.server.close()
    harness.checkpointer.close()
    harness.repositories.close()
  })

  it('persists a failed task when the selected model cannot execute', async () => {
    const harness = createHarness({
      async complete() {
        throw Object.assign(new Error('Model gpt-real is disabled'), {
          code: 'invalid-request',
          retryable: false
        })
      }
    })
    const { taskId } = await harness.server.execute('task.submit', {
      goal: 'Use the selected model',
      model,
      skills: []
    }) as { taskId: string }

    await vi.waitFor(async () => {
      await expect(harness.repositories.tasks.get(taskId)).resolves.toMatchObject({
        status: 'failed',
        error: expect.objectContaining({ message: expect.stringContaining('disabled') })
      })
    })
    await harness.server.close()
    harness.checkpointer.close()
    harness.repositories.close()
  })
})
