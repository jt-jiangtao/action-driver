import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  SqliteRuntimeRepositories,
  openRuntimeDatabase,
  type PersistedMessage,
  type PersistedSkillInvocation,
  type PersistedStep,
  type RuntimeEventRecord,
  type RuntimeTaskRecord
} from '../src/index'

const temporaryDirectories: string[] = []

function createRepositories(): SqliteRuntimeRepositories {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-repositories-'))
  temporaryDirectories.push(directory)
  return new SqliteRuntimeRepositories(openRuntimeDatabase(join(directory, 'actiondriver.db')))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const task: RuntimeTaskRecord = {
  id: 'task-1',
  threadId: 'task-1',
  goal: 'research a product',
  status: 'running',
  lastCheckpointId: 'checkpoint-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('SQLite runtime repositories', () => {
  it('stores and reads tasks, messages, steps, skill invocations, and ordered events', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)

    const message: PersistedMessage = {
      id: 'message-1',
      taskId: task.id,
      role: 'user',
      content: { text: 'research a product' },
      createdAt: task.createdAt
    }
    const step: PersistedStep = {
      id: 'step-1',
      taskId: task.id,
      stepKey: 'plan',
      title: 'Plan',
      detail: 'Create a plan',
      status: 'completed',
      checkpointId: 'checkpoint-1',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
    const invocation: PersistedSkillInvocation = {
      id: 'invocation-1',
      taskId: task.id,
      requestedSkillId: 'browser-use',
      resolvedProviderId: 'mock.browser',
      providerVersion: '1.0.0',
      contractVersion: 1,
      status: 'completed',
      input: { url: 'https://example.com' },
      output: { title: 'Example' },
      error: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }

    await repositories.messages.save(message)
    await repositories.steps.save(step)
    await repositories.skillInvocations.save(invocation)
    const event = await repositories.events.append({
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: 'checkpoint-1',
      eventKey: 'task.started',
      type: 'task.started',
      payload: { status: 'running' },
      occurredAt: task.createdAt
    })

    await expect(repositories.tasks.get(task.id)).resolves.toEqual(task)
    await expect(repositories.messages.listByTask(task.id)).resolves.toEqual([message])
    await expect(repositories.steps.listByTask(task.id)).resolves.toEqual([step])
    await expect(repositories.skillInvocations.listByTask(task.id)).resolves.toEqual([invocation])
    await expect(repositories.events.listAfter(0)).resolves.toEqual([{ ...event, cursor: 1 }])

    repositories.close()
  })

  it('commits a task state change and its event atomically', async () => {
    const repositories = createRepositories()
    await repositories.tasks.save(task)
    const completed = { ...task, status: 'completed', updatedAt: '2026-01-01T00:01:00.000Z' }
    const event: Omit<RuntimeEventRecord, 'cursor'> = {
      taskId: task.id,
      threadId: task.threadId,
      checkpointId: 'checkpoint-2',
      eventKey: 'task.completed',
      type: 'task.completed',
      payload: { status: 'completed' },
      occurredAt: completed.updatedAt
    }

    await repositories.commitTaskStateWithEvent(completed, event)
    await expect(repositories.tasks.get(task.id)).resolves.toMatchObject({ status: 'completed' })
    await expect(repositories.events.listAfter(0)).resolves.toHaveLength(1)

    const conflicting = { ...completed, status: 'failed', updatedAt: '2026-01-01T00:02:00.000Z' }
    await expect(repositories.commitTaskStateWithEvent(conflicting, event)).rejects.toThrow()
    await expect(repositories.tasks.get(task.id)).resolves.toMatchObject({ status: 'completed' })
    await expect(repositories.events.listAfter(0)).resolves.toHaveLength(1)

    repositories.close()
  })

  it('keeps database drivers out of Electron Main and Renderer sources', () => {
    const desktopSource = resolve(process.cwd(), 'apps/desktop/src')
    const sourceFiles = readdirSync(desktopSource, { recursive: true })
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
      .filter((entry) => /\.[cm]?[jt]sx?$/.test(entry))
      .map((entry) => readFileSync(join(desktopSource, entry), 'utf8'))

    expect(sourceFiles.join('\n')).not.toMatch(
      /from ['"]better-sqlite3['"]|require\(['"]better-sqlite3['"]\)/
    )
  })
})
