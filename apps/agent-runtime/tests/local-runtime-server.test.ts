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
