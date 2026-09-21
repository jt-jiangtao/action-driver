import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DeterministicModelGateway,
  LangGraphRunner,
  MockSkillRegistry,
  ProjectionService,
  SqliteRuntimeRepositories,
  createSqliteCheckpointer,
  openRuntimeDatabase
} from '../src/index'

const temporaryDirectories: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-projection-'))
  temporaryDirectories.push(directory)
  return join(directory, 'actiondriver.db')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('ProjectionService reconciliation', () => {
  it('repairs a checkpoint committed before its business projection without duplicate events', async () => {
    const path = databasePath()
    const firstRepositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    const firstCheckpointer = createSqliteCheckpointer(path)
    const runtime = new LangGraphRunner(
      new DeterministicModelGateway(),
      new MockSkillRegistry(),
      firstCheckpointer
    )

    await expect(
      runtime.run({ taskId: 'task-crash-window', goal: 'recover after crash' })
    ).resolves.toMatchObject({ status: 'completed' })
    await expect(firstRepositories.tasks.get('task-crash-window')).resolves.toBeNull()

    firstCheckpointer.db.close()
    firstRepositories.close()

    const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    const checkpointer = createSqliteCheckpointer(path)
    const service = new ProjectionService(checkpointer, repositories)

    await expect(service.reconcile()).resolves.toEqual({ scanned: 1, projected: 1, skipped: 0 })
    const task = await repositories.tasks.get('task-crash-window')
    expect(task).toMatchObject({
      id: 'task-crash-window',
      threadId: 'task-crash-window',
      goal: 'recover after crash',
      status: 'completed'
    })
    expect(task?.lastCheckpointId).toBeTruthy()

    const firstEvents = await repositories.events.listAfter(0)
    expect(firstEvents).toHaveLength(1)
    expect(firstEvents[0]).toMatchObject({
      taskId: 'task-crash-window',
      threadId: 'task-crash-window',
      checkpointId: task?.lastCheckpointId,
      eventKey: 'checkpoint.projected',
      type: 'task.projected'
    })

    await expect(service.reconcile()).resolves.toEqual({ scanned: 1, projected: 0, skipped: 1 })
    await expect(repositories.events.listAfter(0)).resolves.toEqual(firstEvents)

    checkpointer.db.close()
    repositories.close()
  })
})
