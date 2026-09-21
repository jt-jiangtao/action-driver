import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RUNTIME_TYPES,
  createLocalRuntimeAdapters,
  createRuntimeContainer,
  type CheckpointStore,
  type TaskRepository
} from '../src/index'

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'actiondriver-local-runtime-')), 'actiondriver.db')
}

describe('local runtime adapters', () => {
  it('binds SQLite-backed task and checkpoint ports without falling back to mock storage', async () => {
    const path = databasePath()
    const local = createLocalRuntimeAdapters(path, async () => {
      throw new Error('Skill execution is not needed')
    })
    const container = createRuntimeContainer({ mode: 'local', adapters: local.adapters })
    const tasks = container.get<TaskRepository>(RUNTIME_TYPES.taskRepository)
    const checkpoints = container.get<CheckpointStore>(RUNTIME_TYPES.checkpointStore)

    await tasks.save({
      id: 'task-local',
      threadId: 'task-local',
      goal: 'Persist locally',
      status: 'running',
      lastCheckpointId: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z'
    })
    await checkpoints.put('task-local', { stage: 'accepted' })

    await expect(tasks.get('task-local')).resolves.toMatchObject({ goal: 'Persist locally' })
    await expect(checkpoints.get('task-local')).resolves.toEqual({ stage: 'accepted' })
    local.close()
  })
})
