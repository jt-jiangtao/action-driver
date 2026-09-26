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
import { ComputerUseControlGate } from '../src/computer-use/control-gate'
import { AppApprovalBroker } from '../src/computer-use/app-approval-broker'

function createHarness(
  modelGateway: ModelGateway,
  streamSnapshots?: {
    getTaskSnapshot(
      taskId: string
    ): Promise<Extract<StreamServerEvent, { type: 'response.snapshot' }> | null>
  },
  computerControl?: ComputerUseControlGate,
  appApprovals?: AppApprovalBroker,
  appApprovalStore?: { list(): string[]; remove(bundleId: string): void }
) {
  const path = join(mkdtempSync(join(tmpdir(), 'actiondriver-server-')), 'actiondriver.db')
  const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
  const checkpointer = createSqliteCheckpointer(path)
  const local = createLocalRuntimeAdapters({ repositories, checkpointer, modelGateway })
  const server = createLocalRuntimeServer({
    adapters: local.adapters,
    ...(appApprovals ? { appApprovals } : {}),
    ...(appApprovalStore ? { appApprovalStore } : {}),
    ...(computerControl ? { computerControl } : {}),
    messages: repositories.messages,
    ...(streamSnapshots ? { streamSnapshots } : {})
  })
  return { server, repositories, checkpointer, toolRuntime: local.toolRuntime }
}

const model = { connectionId: 'connection-1', modelId: 'gpt-real' }

describe('local Runtime server composition', () => {
  // 3.2: the settings page lists and revokes persisted "always allow" grants through these commands.
  it('lists and removes always-allowed applications', async () => {
    const allowed = new Set(['com.apple.Notes', 'com.apple.Preview'])
    const store = {
      list: () => [...allowed].sort(),
      remove: (bundleId: string) => {
        allowed.delete(bundleId)
      }
    }
    const harness = createHarness({ complete: async () => ({ kind: 'finish', content: 'unused' }) }, undefined, undefined, undefined, store)
    await expect(harness.server.execute('computer-use.always-allowed.list', {})).resolves.toEqual({
      bundleIds: ['com.apple.Notes', 'com.apple.Preview']
    })
    await expect(
      harness.server.execute('computer-use.always-allowed.remove', { bundleId: 'com.apple.Notes' })
    ).resolves.toEqual({ bundleIds: ['com.apple.Preview'] })
    await expect(
      harness.server.execute('computer-use.always-allowed.remove', { bundleId: '  ' })
    ).rejects.toThrow(/bundleId/)
    harness.repositories.close()
  })

  it('reports Computer Use as unavailable without an approval store', async () => {
    const harness = createHarness({ complete: async () => ({ kind: 'finish', content: 'unused' }) })
    await expect(harness.server.execute('computer-use.always-allowed.list', {})).rejects.toThrow(
      /COMPUTER_USE_UNAVAILABLE/
    )
    harness.repositories.close()
  })

  it('settles the same broker without calling the graph or replaying a task', async () => {
    const complete = vi.fn(async () => ({ kind: 'finish' as const, content: 'unexpected' }))
    const broker = new AppApprovalBroker({
      queryPolicy: async () => ({
        decision: 'allowed',
        allowPersistentApproval: true,
        target: {
          bundleId: 'com.apple.Notes',
          displayName: 'Notes',
          appPath: '/System/Applications/Notes.app',
          risk: 'low'
        }
      }),
      isAlwaysAllowed: async () => false,
      persistAlwaysAllowed: async () => {},
      emit: () => {},
      withSuspendedTimeout: async (_, wait) => wait()
    })
    const harness = createHarness({ complete }, undefined, undefined, broker)
    const waiting = broker.authorize(
      { taskId: 'stream-task', sessionId: 'session' },
      { app: 'Notes' }
    )
    await vi.waitFor(() => expect(broker.getPending('stream-task')).toHaveLength(1))
    const requestId = broker.getPending('stream-task')[0]!.requestId
    await expect(
      harness.server.execute('task.decide-app-approval', {
        taskId: 'foreign-task',
        requestId,
        decision: 'once'
      })
    ).rejects.toThrow('APPROVAL_STALE')
    await expect(
      harness.server.execute('task.decide-app-approval', {
        taskId: 'stream-task',
        requestId,
        decision: 'once'
      })
    ).resolves.toEqual({ accepted: true })
    await expect(waiting).resolves.toMatchObject({ app: '/System/Applications/Notes.app' })
    await expect(
      harness.server.execute('task.decide-app-approval', {
        taskId: 'stream-task',
        requestId,
        decision: 'once'
      })
    ).rejects.toThrow('APPROVAL_STALE')
    expect(complete).not.toHaveBeenCalled()
    await harness.server.close()
  })
  it('interrupts a Computer Use task on takeover and resumes only after control returns', async () => {
    const gate = new ComputerUseControlGate()
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let calls = 0
    const harness = createHarness(
      {
        async complete(_request, signal) {
          if (++calls > 1) return { kind: 'finish', content: '完成' }
          started()
          return await new Promise((_, reject) =>
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true }
            )
          )
        }
      },
      undefined,
      gate
    )
    const { taskId } = (await harness.server.execute('task.submit', {
      goal: '操作桌面',
      model,
      skills: []
    })) as { taskId: string }
    await firstStarted
    const taken = (await harness.server.execute('skill.control', {
      invocationId: taskId,
      command: 'take-over'
    })) as { event: { skillId: string; state: string } }
    expect(taken.event).toMatchObject({ skillId: 'computer-use', state: 'taken-over' })
    expect(() => gate.assertRunning(taskId)).toThrow('COMPUTER_USE_TAKEN_OVER')
    await harness.server.execute('skill.control', { invocationId: taskId, command: 'resume' })
    await vi.waitFor(async () =>
      expect((await harness.repositories.tasks.get(taskId))?.status).toBe('completed')
    )
    expect(() => gate.assertRunning(taskId)).not.toThrow()
  })
  it('restores the first turn duration and activity when opening a later turn', async () => {
    let firstTaskId = ''
    const snapshots = {
      async getTaskSnapshot(taskId: string) {
        if (taskId !== firstTaskId) return null
        return {
          type: 'response.snapshot',
          taskId,
          durationMs: 5_000,
          activities: [
            {
              activityId: 'first-group',
              title: '测试工具',
              titleRevision: 1,
              status: 'completed',
              items: [{ id: 'tool:first', kind: 'tool', callId: 'first' }]
            }
          ],
          activityTimeline: [
            { id: 'activity:first-group', kind: 'activity', activityId: 'first-group' }
          ],
          tools: [
            {
              callId: 'first',
              toolId: 'web.search@1',
              modelName: 'web_search',
              summary: '搜索网页',
              argumentsHash: 'hash',
              status: 'completed'
            }
          ]
        } as Extract<StreamServerEvent, { type: 'response.snapshot' }>
      }
    }
    const harness = createHarness(
      {
        async complete() {
          return { kind: 'finish', content: '第一答' }
        }
      },
      snapshots
    )
    const first = (await harness.server.execute('task.submit', {
      goal: '测试所有工具',
      model,
      skills: []
    })) as { taskId: string }
    firstTaskId = first.taskId
    await vi.waitFor(async () => {
      await expect(harness.repositories.tasks.get(firstTaskId)).resolves.toMatchObject({
        status: 'completed'
      })
    })
    const firstRecord = (await harness.repositories.tasks.get(firstTaskId))!
    const firstUser = (await harness.repositories.messages.listByTask(firstTaskId)).find(
      (message) => message.role === 'user'
    )!
    const secondStartedAt = new Date(Date.parse(firstRecord.createdAt) + 1_000).toISOString()
    const secondEndedAt = new Date(Date.parse(firstRecord.createdAt) + 2_000).toISOString()
    await harness.repositories.tasks.save({
      ...firstRecord,
      id: 'second-task',
      threadId: 'second-task',
      goal: '111',
      createdAt: secondStartedAt,
      updatedAt: secondEndedAt
    })
    await harness.repositories.messages.save({
      id: 'second-user',
      taskId: 'second-task',
      role: 'user',
      content: '111',
      createdAt: secondStartedAt
    })
    await harness.repositories.messages.save({
      id: 'second-answer',
      taskId: 'second-task',
      role: 'assistant',
      content: '第二答',
      createdAt: secondEndedAt
    })
    const { task } = (await harness.server.execute('task.get', { taskId: 'second-task' })) as {
      task: { priorActivityTurns?: unknown[] }
    }
    expect(task.priorActivityTurns).toMatchObject([
      {
        taskId: firstTaskId,
        userMessageId: firstUser.id,
        durationMs: 5_000,
        activities: [{ activityId: 'first-group' }],
        activityTimeline: [{ activityId: 'first-group' }],
        tools: [{ callId: 'first' }]
      }
    ])
    const { task: reopenedFirst } = (await harness.server.execute('task.get', {
      taskId: firstTaskId
    })) as {
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
              toolId: 'local.shell.run',
              modelName: 'shell_run',
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
    const { taskId } = (await harness.server.execute('task.submit', {
      goal: '读取 README',
      model,
      skills: []
    })) as { taskId: string }
    await vi.waitFor(async () => {
      const { task } = (await harness.server.execute('task.get', { taskId })) as {
        task: Record<string, unknown>
      }
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
    const { taskId } = (await harness.server.execute('task.submit', {
      goal: 'Book a hotel',
      model,
      skills: []
    })) as { taskId: string }

    await vi.waitFor(async () => {
      const { task } = (await harness.server.execute('task.get', { taskId })) as {
        task: Record<string, unknown>
      }
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
    const { taskId } = (await harness.server.execute('task.submit', {
      goal: 'Use the selected model',
      model,
      skills: []
    })) as { taskId: string }

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
