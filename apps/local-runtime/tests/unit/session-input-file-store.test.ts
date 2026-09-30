import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openRuntimeDatabase,
  type RuntimeTaskRecord
} from '../../src/index'
import { createTestRepositories } from './rollout/test-repositories'
import {
  MAX_INPUT_FILE_BYTES,
  SessionInputFileStore,
  InputFileError
} from '../../src/media/session-input-file-store'
import { SessionWorkspaceStore } from '../../src/execution/session-workspace'

const temporaryDirectories: string[] = []

function createStorage() {
  const directory = mkdtempSync(join(tmpdir(), 'action-driver-input-store-'))
  temporaryDirectories.push(directory)
  const database = openRuntimeDatabase(join(directory, 'action-driver.db'))
  const repositories = createTestRepositories(directory)
  const workspaceRoot = join(directory, 'workspace')
  const store = new SessionInputFileStore({
    database,
    rootDirectory: directory,
    workspaces: new SessionWorkspaceStore({ workspaceRoot })
  })
  return { directory, database, repositories, store, workspaceRoot }
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
    goal: 'attach documents',
    model: { connectionId: 'connection-1', modelId: 'gpt-real' },
    status: 'running',
    error: null,
    lastCheckpointId: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z'
  }
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
const DOCX_BYTES = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 7)])

describe('session input file store', () => {
  it('materializes an uploaded document into the session input directory', async () => {
    const { store, repositories, workspaceRoot } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    const staged = await store.stageUpload({
      bytes: PDF_BYTES,
      name: 'quarterly report.pdf',
      mimeType: 'application/pdf'
    })

    const bound = await store.bind(staged.fileId, { sessionId: 'session-1', taskId: 'task-1' })

    expect(bound).toMatchObject({
      fileId: staged.fileId,
      sessionId: 'session-1',
      taskId: 'task-1',
      name: 'quarterly report.pdf',
      mimeType: 'application/pdf',
      byteLength: PDF_BYTES.byteLength,
      relativePath: 'input/quarterly report.pdf'
    })
    const materialized = join(
      workspaceRoot,
      'sessions',
      'session-1',
      'input',
      'quarterly report.pdf'
    )
    expect(existsSync(materialized)).toBe(true)
    expect(readFileSync(materialized).equals(PDF_BYTES)).toBe(true)
    expect(await store.read(staged.fileId, 'session-1')).toMatchObject({
      name: 'quarterly report.pdf',
      mimeType: 'application/pdf'
    })
  })

  it('keeps same-named uploads apart in one session', async () => {
    const { store, repositories } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    await repositories.tasks.save(task('task-2', 'session-1'))
    const first = await store.stageUpload({
      bytes: PDF_BYTES,
      name: 'report.pdf',
      mimeType: 'application/pdf'
    })
    const second = await store.stageUpload({
      bytes: Buffer.concat([PDF_BYTES, Buffer.from('%second')]),
      name: 'report.pdf',
      mimeType: 'application/pdf'
    })

    const boundFirst = await store.bind(first.fileId, {
      sessionId: 'session-1',
      taskId: 'task-1'
    })
    const boundSecond = await store.bind(second.fileId, {
      sessionId: 'session-1',
      taskId: 'task-2'
    })

    expect(boundFirst.relativePath).toBe('input/report.pdf')
    expect(boundSecond.relativePath).not.toBe(boundFirst.relativePath)
    expect((await store.read(second.fileId, 'session-1')).bytes.length).toBe(
      PDF_BYTES.byteLength + '%second'.length
    )
  })

  it('accepts the supported document and image formats only', async () => {
    const { store } = createStorage()
    for (const format of [
      { name: 'a.pdf', mimeType: 'application/pdf', bytes: PDF_BYTES },
      {
        name: 'a.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: DOCX_BYTES
      },
      {
        name: 'a.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: DOCX_BYTES
      },
      {
        name: 'a.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        bytes: DOCX_BYTES
      },
      {
        name: 'a.png',
        mimeType: 'image/png',
        bytes: readFileSync(join(process.cwd(), 'apps/local-runtime/tests/fixtures/tiny.png'))
      }
    ]) {
      await expect(store.stageUpload(format)).resolves.toMatchObject({
        name: format.name,
        mimeType: format.mimeType
      })
    }

    for (const rejected of [
      { name: 'notes.txt', mimeType: 'text/plain', bytes: Buffer.from('hello') },
      { name: 'archive.zip', mimeType: 'application/zip', bytes: DOCX_BYTES },
      { name: 'fake.pdf', mimeType: 'application/pdf', bytes: Buffer.from('not a pdf at all') },
      { name: 'mismatch.pdf', mimeType: 'application/pdf', bytes: DOCX_BYTES },
      { name: 'image.pdf', mimeType: 'image/png', bytes: Buffer.from('nope') },
      { name: 'empty.pdf', mimeType: 'application/pdf', bytes: Buffer.alloc(0) }
    ]) {
      await expect(store.stageUpload(rejected)).rejects.toBeInstanceOf(InputFileError)
    }
  })

  it('refuses oversized files, unsafe names and traversal', async () => {
    const { store } = createStorage()

    await expect(
      store.stageUpload({
        bytes: Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_INPUT_FILE_BYTES)]),
        name: 'huge.pdf',
        mimeType: 'application/pdf'
      })
    ).rejects.toMatchObject({ code: 'INPUT_FILE_TOO_LARGE' })

    for (const name of ['../escape.pdf', 'nested/report.pdf', '', '.hidden.pdf']) {
      await expect(
        store.stageUpload({ bytes: PDF_BYTES, name, mimeType: 'application/pdf' })
      ).rejects.toMatchObject({ code: 'INPUT_FILE_NAME_INVALID' })
    }
  })

  it('binds only to the session that uploads the file', async () => {
    const { store, repositories } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    await repositories.tasks.save(task('task-2', 'session-2'))
    const staged = await store.stageUpload({
      bytes: PDF_BYTES,
      name: 'report.pdf',
      mimeType: 'application/pdf'
    })
    await store.bind(staged.fileId, { sessionId: 'session-1', taskId: 'task-1' })

    await expect(store.read(staged.fileId, 'session-2')).rejects.toMatchObject({
      code: 'INPUT_FILE_SESSION_MISMATCH'
    })
    await expect(
      store.bind(staged.fileId, { sessionId: 'session-2', taskId: 'task-2' })
    ).rejects.toMatchObject({ code: 'INPUT_FILE_NOT_STAGED' })
    await expect(
      store.bind('missing-file', { sessionId: 'session-2', taskId: 'task-2' })
    ).rejects.toMatchObject({ code: 'INPUT_FILE_NOT_FOUND' })
  })

  it('rejects a file whose bytes were replaced after staging', async () => {
    const { store, directory, repositories } = createStorage()
    await repositories.tasks.save(task('task-1', 'session-1'))
    const staged = await store.stageUpload({
      bytes: PDF_BYTES,
      name: 'report.pdf',
      mimeType: 'application/pdf'
    })
    writeFileSync(join(directory, 'input-files', 'staging', staged.fileId), 'tampered')

    await expect(
      store.bind(staged.fileId, { sessionId: 'session-1', taskId: 'task-1' })
    ).rejects.toMatchObject({ code: 'INPUT_FILE_CHECKSUM_MISMATCH' })
  })
})
