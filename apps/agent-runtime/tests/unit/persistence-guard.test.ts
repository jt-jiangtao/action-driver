import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SqliteRuntimeRepositories,
  assertPersistablePayload,
  createSqliteCheckpointer,
  openRuntimeDatabase,
  type PersistedSkillInvocation,
  type RuntimeTaskRecord
} from '../../src/index'
import { RolloutSessionStore } from '../../src/rollout/session-store'

const temporaryDirectories: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-payload-guard-'))
  temporaryDirectories.push(directory)
  return join(directory, 'actiondriver.db')
}

/** History lives in the rollout log; skill invocations stay in the state database. */
function createRepositories(path: string) {
  const root = join(path, '..')
  const state = new SqliteRuntimeRepositories(openRuntimeDatabase(join(root, 'state.sqlite')))
  const rollout = new RolloutSessionStore({
    sessionsRoot: root,
    statePath: join(root, 'rollout-state.sqlite'),
    historyPath: join(root, 'rollout-history.sqlite')
  })
  return Object.assign(rollout, {
    inputFiles: state.inputFiles,
    skillInvocations: state.skillInvocations
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const task: RuntimeTaskRecord = {
  id: 'task-guard',
  threadId: 'task-guard',
  sessionId: 'task-guard',
  goal: 'guard payloads',
  model: { connectionId: 'connection-1', modelId: 'gpt-real' },
  status: 'running',
  error: null,
  lastCheckpointId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function invocation(input: unknown, output: unknown = null): PersistedSkillInvocation {
  return {
    id: `invocation-${Math.random()}`,
    taskId: task.id,
    requestedSkillId: 'browser-use',
    resolvedProviderId: 'mock.browser',
    providerVersion: '1.0.0',
    contractVersion: 1,
    status: 'completed',
    input,
    output,
    error: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

describe('persistence payload guard', () => {
  it('allows repeated references to a plain value but rejects a true cycle', () => {
    const shared = { goal: 'same value' }
    expect(() => assertPersistablePayload({ input: shared, output: shared })).not.toThrow()

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => assertPersistablePayload(cyclic)).toThrow('cyclic reference')
  })

  it('rejects DOM and Electron objects before writing history', async () => {
    const repositories = createRepositories(databasePath())
    await repositories.tasks.save(task)
    const domDocument = (
      globalThis as typeof globalThis & {
        document: { createElement(tagName: string): object }
      }
    ).document

    await expect(
      repositories.messages.save({
        id: 'message-dom',
        taskId: task.id,
        role: 'user',
        content: domDocument.createElement('button'),
        createdAt: task.createdAt
      })
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED')

    class FakeWebContents {
      send(): void {}
    }
    await expect(
      repositories.messages.save({
        id: 'message-electron',
        taskId: task.id,
        role: 'agent',
        content: new FakeWebContents(),
        createdAt: task.createdAt
      })
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED')
    await expect(repositories.messages.listByTask(task.id)).resolves.toEqual([])
    repositories.close()
  })

  it('rejects live handles, coordinate references, cookies, and session tokens', async () => {
    const repositories = createRepositories(databasePath())
    await repositories.tasks.save(task)

    await expect(
      repositories.skillInvocations.save(invocation({ nodeHandle: 'live-node-7' }))
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED')
    await expect(
      repositories.skillInvocations.save(invocation({ action: 'click', x: 120, y: 80 }))
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED')
    await expect(
      repositories.events.append({
        taskId: task.id,
        threadId: task.threadId,
        checkpointId: 'checkpoint-secret',
        eventKey: 'secret',
        type: 'secret',
        payload: { cookie: 'sid=raw', sessionToken: 'raw-session-token' },
        occurredAt: task.createdAt
      })
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED')
    await expect(repositories.skillInvocations.listByTask(task.id)).resolves.toEqual([])
    await expect(repositories.events.listAfter(0)).resolves.toEqual([])
    repositories.close()
  })

  it('rejects forbidden values before the official checkpointer writes them', async () => {
    const checkpointer = createSqliteCheckpointer(databasePath())
    const checkpoint = {
      v: 1,
      id: 'checkpoint-guard',
      ts: '2026-01-01T00:00:00.000Z',
      channel_values: { taskId: task.id, sessionToken: 'raw-session-token' },
      channel_versions: {},
      versions_seen: {},
      pending_sends: []
    } as Parameters<typeof checkpointer.put>[1]

    await expect(
      checkpointer.put(
        { configurable: { thread_id: task.threadId, checkpoint_ns: '' } },
        checkpoint,
        { source: 'input', step: -1, parents: {} }
      )
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED')
    expect(
      checkpointer.db.prepare('SELECT COUNT(*) AS count FROM checkpoints').get() as {
        count: number
      }
    ).toEqual({ count: 0 })
    checkpointer.db.close()
  })
})
