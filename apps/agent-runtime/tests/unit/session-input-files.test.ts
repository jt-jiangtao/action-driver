import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type RuntimeTaskRecord, type SessionInputFileRecord } from '../../src/index'
import { createTestRepositories, type TestRepositories } from './rollout/test-repositories'

const temporaryDirectories: string[] = []

function createStorage(): { repositories: TestRepositories; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'action-driver-input-files-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'action-driver.db')
  return { repositories: createTestRepositories(directory), path }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function task(id: string, sessionId: string): RuntimeTaskRecord {
  return {
    id,
    threadId: id,
    sessionId,
    goal: 'attach a document',
    model: { connectionId: 'connection-1', modelId: 'gpt-real' },
    status: 'running',
    error: null,
    lastCheckpointId: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z'
  }
}

function boundInput(overrides: Partial<SessionInputFileRecord> = {}): SessionInputFileRecord {
  return {
    fileId: 'file-1',
    status: 'bound',
    sessionId: 'session-1',
    taskId: 'task-1',
    name: 'quarterly.pdf',
    mimeType: 'application/pdf',
    byteLength: 2048,
    relativePath: 'input/quarterly.pdf',
    checksum: 'sha256:first',
    createdAt: '2026-09-26T00:00:00.000Z',
    boundAt: '2026-09-26T00:00:01.000Z',
    ...overrides
  }
}

describe('session input file records', () => {
  it('restores an input file with its upload task, session, name and format after reopening', async () => {
    const { repositories, path } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    await repositories.inputFiles.save(boundInput())
    repositories.close()

    const reopened = createTestRepositories(join(path, '..'))
    await expect(reopened.inputFiles.get('file-1')).resolves.toEqual(boundInput())
    reopened.close()
  })

  it('lists only the input files owned by one session or task', async () => {
    const { repositories } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    await repositories.tasks.save(task('task-2', 'session-2'))
    await repositories.inputFiles.save(boundInput())
    await repositories.inputFiles.save(
      boundInput({
        fileId: 'file-2',
        taskId: 'task-2',
        sessionId: 'session-2',
        name: 'other.xlsx'
      })
    )

    expect(
      (await repositories.inputFiles.listBySession('session-1')).map((file) => file.fileId)
    ).toEqual(['file-1'])
    expect((await repositories.inputFiles.listByTask('task-2')).map((file) => file.fileId)).toEqual(
      ['file-2']
    )
  })

  it('keeps an uploaded file staged until it is bound to a task and session', async () => {
    const { repositories } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    await repositories.inputFiles.save(
      boundInput({
        status: 'staged',
        sessionId: null,
        taskId: null,
        relativePath: null,
        boundAt: null
      })
    )

    expect(await repositories.inputFiles.get('file-1')).toMatchObject({
      status: 'staged',
      sessionId: null,
      taskId: null,
      relativePath: null
    })

    await repositories.inputFiles.bind('file-1', {
      sessionId: 'session-1',
      taskId: 'task-1',
      relativePath: 'input/quarterly.pdf',
      boundAt: '2026-09-26T00:00:02.000Z'
    })

    expect(await repositories.inputFiles.get('file-1')).toEqual(
      boundInput({ boundAt: '2026-09-26T00:00:02.000Z' })
    )
    await expect(
      repositories.inputFiles.bind('file-1', {
        sessionId: 'session-1',
        taskId: 'task-1',
        relativePath: 'input/quarterly.pdf',
        boundAt: '2026-09-26T00:00:03.000Z'
      })
    ).rejects.toThrow('INPUT_FILE_NOT_STAGED')
  })

  it('leaves staged records alone when the identifier is unknown', async () => {
    const { repositories } = createStorage()
    await repositories.inputFiles.save(
      boundInput({
        status: 'staged',
        sessionId: null,
        taskId: null,
        relativePath: null,
        boundAt: null
      })
    )

    await expect(
      repositories.inputFiles.bind('unknown-file', {
        sessionId: 'session-1',
        taskId: 'task-1',
        relativePath: 'input/quarterly.pdf',
        boundAt: '2026-09-26T00:00:02.000Z'
      })
    ).rejects.toThrow('INPUT_FILE_NOT_STAGED')
    expect(await repositories.inputFiles.get('file-1')).toMatchObject({ status: 'staged' })
  })
})
