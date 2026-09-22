import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_TYPES,
  SqliteRuntimeRepositories,
  createLocalRuntimeAdapters,
  createRuntimeContainer,
  createSqliteCheckpointer,
  openRuntimeDatabase,
  type CheckpointStore,
  type ModelGateway,
  type TaskRepository
} from '../src/index'

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'actiondriver-local-runtime-')), 'actiondriver.db')
}

describe('local runtime adapters', () => {
  it('binds injected real model and SQLite ports without production Skill providers', async () => {
    const path = databasePath()
    const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    const checkpointer = createSqliteCheckpointer(path)
    const modelGateway: ModelGateway = {
      async complete() {
        return { kind: 'finish', content: 'real result' }
      }
    }
    const local = createLocalRuntimeAdapters({ repositories, checkpointer, modelGateway })
    const container = createRuntimeContainer({ mode: 'local', adapters: local.adapters })
    const tasks = container.get<TaskRepository>(RUNTIME_TYPES.taskRepository)
    const checkpoints = container.get<CheckpointStore>(RUNTIME_TYPES.checkpointStore)

    expect(container.get<ModelGateway>(RUNTIME_TYPES.modelGateway)).toBe(modelGateway)
    expect(() => local.adapters.skillRegistry.resolve('browser-use', 1)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(() => local.adapters.skillRegistry.resolve('computer-use', 1)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )

    await tasks.save({
      id: 'task-local',
      threadId: 'task-local',
      goal: 'Persist locally',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      status: 'running',
      error: null,
      lastCheckpointId: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z'
    })
    await checkpoints.put('task-local', { stage: 'accepted' })

    await expect(tasks.get('task-local')).resolves.toMatchObject({ goal: 'Persist locally' })
    await expect(checkpoints.get('task-local')).resolves.toEqual({ stage: 'accepted' })
    checkpointer.close()
    repositories.close()
  })
})
