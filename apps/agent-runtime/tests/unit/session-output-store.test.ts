import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openRuntimeDatabase } from '../../src/database'
import { SessionWorkspaceStore } from '../../src/execution/session-workspace'
import { SessionOutputStore } from '../../src/media/session-output-store'

const temporaryDirectories: string[] = []

function createStorage() {
  const directory = mkdtempSync(join(tmpdir(), 'action-driver-output-store-'))
  temporaryDirectories.push(directory)
  const database = openRuntimeDatabase(join(directory, 'action-driver.db'))
  const workspaceRoot = join(directory, 'workspace')
  const workspaces = new SessionWorkspaceStore({ workspaceRoot })
  const store = new SessionOutputStore({ database, rootDirectory: directory, workspaces })
  return { directory, database, store, workspaceRoot, workspaces }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
const docx = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(32, 3)])

async function outputPath(workspaceRoot: string, sessionId: string, name: string): Promise<string> {
  const path = join(workspaceRoot, 'sessions', sessionId, 'output', name)
  mkdirSync(join(path, '..'), { recursive: true })
  return path
}

describe('session output registration', () => {
  it('registers new and updated deliverables and skips untouched ones', async () => {
    const { store, workspaceRoot } = createStorage()
    const sessionId = 'session-1'
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'old.pdf'), pdf)
    const baseline = await store.baseline(sessionId)

    writeFileSync(await outputPath(workspaceRoot, sessionId, 'new.pptx'), docx)

    const changes = await store.detectChanges(sessionId, baseline)
    expect(changes.map((file) => file.relativePath)).toEqual(['new.pptx'])

    writeFileSync(
      await outputPath(workspaceRoot, sessionId, 'old.pdf'),
      Buffer.concat([pdf, Buffer.from('%updated')])
    )
    const updated = await store.detectChanges(sessionId, baseline)
    expect(updated.map((file) => file.relativePath).sort()).toEqual(['new.pptx', 'old.pdf'])
  })

  it('ignores scripts, previews, disguised extensions and symlinks', async () => {
    const { store, workspaceRoot, directory } = createStorage()
    const sessionId = 'session-1'
    const baseline = await store.baseline(sessionId)
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'build.mjs'), 'console.log(1)')
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'preview.tmp'), 'tmp')
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'notes.txt'), 'notes')
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'fake.pdf'), 'not really a pdf')
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'fake.docx'), pdf)
    writeFileSync(join(directory, 'private.pdf'), pdf)
    symlinkSync(
      join(directory, 'private.pdf'),
      await outputPath(workspaceRoot, sessionId, 'link.pdf')
    )
    mkdirSync(join(workspaceRoot, 'sessions', sessionId, 'output', 'reports'), { recursive: true })
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'reports/quarterly.pdf'), pdf)

    const changes = await store.detectChanges(sessionId, baseline)
    expect(changes.map((file) => file.relativePath)).toEqual(['reports/quarterly.pdf'])
  })

  it('keeps a per-task snapshot that later output writes cannot change', async () => {
    const { store, workspaceRoot, database } = createStorage()
    const sessionId = 'session-1'
    const baseline = await store.baseline(sessionId)
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'report.pdf'), pdf)
    const changes = await store.detectChanges(sessionId, baseline)
    const [registered] = await store.register({
      sessionId,
      taskId: 'task-a',
      files: changes
    })

    expect(registered).toMatchObject({
      taskId: 'task-a',
      name: 'report.pdf',
      relativePath: 'report.pdf',
      byteLength: pdf.byteLength
    })
    writeFileSync(
      await outputPath(workspaceRoot, sessionId, 'report.pdf'),
      Buffer.from('%PDF-1.7\nnew')
    )

    const read = await store.readSnapshot({
      fileId: registered!.fileId,
      taskId: 'task-a',
      sessionId
    })
    expect(Buffer.from(read.bytes).equals(pdf)).toBe(true)
    expect(await store.listByTask('task-a')).toHaveLength(1)
    expect(await store.listByTask('task-b')).toHaveLength(0)
    database.close()
  })

  it('restores the manifest after reopening storage and refuses mismatched owners', async () => {
    const { store, workspaceRoot, database, directory, workspaces } = createStorage()
    const sessionId = 'session-1'
    writeFileSync(await outputPath(workspaceRoot, sessionId, 'report.xlsx'), docx)
    const changes = await store.detectChanges(sessionId, { sessionId, capturedAt: '', entries: {} })
    const [registered] = await store.register({ sessionId, taskId: 'task-a', files: changes })
    database.close()

    const reopened = new SessionOutputStore({
      database: openRuntimeDatabase(join(directory, 'action-driver.db')),
      rootDirectory: directory,
      workspaces
    })
    await expect(reopened.listByTask('task-a')).resolves.toEqual([registered])
    await expect(
      reopened.readSnapshot({ fileId: registered!.fileId, taskId: 'task-b', sessionId })
    ).rejects.toMatchObject({ code: 'OUTPUT_FILE_OWNERSHIP_MISMATCH' })
    await expect(
      reopened.readSnapshot({
        fileId: registered!.fileId,
        taskId: 'task-a',
        sessionId: 'session-2'
      })
    ).rejects.toMatchObject({ code: 'OUTPUT_FILE_OWNERSHIP_MISMATCH' })
    await expect(
      reopened.readSnapshot({ fileId: 'missing', taskId: 'task-a', sessionId })
    ).rejects.toMatchObject({ code: 'OUTPUT_FILE_NOT_FOUND' })
    expect(existsSync(join(directory, 'outputs', sessionId, 'task-a'))).toBe(true)
    reopened['database'].close()
  })
})
