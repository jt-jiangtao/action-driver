import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionWorkspaceStore } from '../src/execution/session-workspace'

const temporaryDirectories: string[] = []

function fixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'actiondriver-session-workspace-'))
  temporaryDirectories.push(workspaceRoot)
  return { workspaceRoot, store: new SessionWorkspaceStore({ workspaceRoot }) }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('session workspace paths', () => {
  it('creates input and output directories for one session', async () => {
    const { workspaceRoot, store } = fixture()

    const workspace = await store.forSession('session-a')

    expect(workspace.root).toBe(join(workspaceRoot, 'sessions', 'session-a'))
    expect(workspace.input).toBe(join(workspace.root, 'input'))
    expect(workspace.output).toBe(join(workspace.root, 'output'))
    expect((await store.forSession('session-a')).output).toBe(workspace.output)
  })

  it('refuses session identifiers that could escape the workspace', async () => {
    const { store } = fixture()

    for (const sessionId of ['', '../session-a', 'a/b', 'a\\b', '.', 'a b']) {
      await expect(store.forSession(sessionId)).rejects.toMatchObject({
        code: 'SESSION_ID_INVALID'
      })
    }
  })

  it('refuses absolute paths and directory traversal in every area', async () => {
    const { store } = fixture()
    await store.forSession('session-a')
    await store.forSession('session-b')

    for (const relativePath of [
      '/etc/passwd',
      '../session-b/output/stolen.pdf',
      'nested/../../session-b/stolen.pdf',
      '..',
      ''
    ]) {
      await expect(store.resolveFile('session-a', 'output', relativePath)).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_INVALID'
      })
    }
  })

  it('refuses symlinks anywhere between the session root and the file', async () => {
    const { workspaceRoot, store } = fixture()
    const workspace = await store.forSession('session-a')
    const outside = join(workspaceRoot, 'outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.txt'), 'secret')

    symlinkSync(join(outside, 'secret.txt'), join(workspace.output, 'link.txt'))
    symlinkSync(outside, join(workspace.output, 'linked-directory'))

    await expect(store.resolveFile('session-a', 'output', 'link.txt')).rejects.toMatchObject({
      code: 'WORKSPACE_SYMLINK_REJECTED'
    })
    await expect(
      store.resolveFile('session-a', 'output', 'linked-directory/secret.txt')
    ).rejects.toMatchObject({ code: 'WORKSPACE_SYMLINK_REJECTED' })
  })

  it('resolves nested files inside the session area and creates parents on request', async () => {
    const { store } = fixture()
    const workspace = await store.forSession('session-a')

    const created = await store.resolveFile('session-a', 'output', 'reports/2026/q3.pdf', {
      createParents: true
    })
    expect(created).toBe(join(workspace.output, 'reports', '2026', 'q3.pdf'))
    await expect(store.resolveFile('session-a', 'output', 'missing/q3.pdf')).rejects.toMatchObject({
      code: 'WORKSPACE_PARENT_MISSING'
    })
  })

  it('reports whether the resolved path is a regular file', async () => {
    const { store } = fixture()
    const workspace = await store.forSession('session-a')
    writeFileSync(join(workspace.output, 'report.pdf'), 'pdf')
    mkdirSync(join(workspace.output, 'folder'))

    await expect(
      store.resolveFile('session-a', 'output', 'report.pdf', { mustBeRegularFile: true })
    ).resolves.toBe(join(workspace.output, 'report.pdf'))
    await expect(
      store.resolveFile('session-a', 'output', 'folder', { mustBeRegularFile: true })
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_A_FILE' })
    await expect(
      store.resolveFile('session-a', 'output', 'absent.pdf', { mustBeRegularFile: true })
    ).rejects.toMatchObject({ code: 'WORKSPACE_FILE_MISSING' })
  })

  it('refuses to cross into another session recorded as a symlink', async () => {
    const { workspaceRoot, store } = fixture()
    const other = await store.forSession('session-b')
    writeFileSync(join(other.output, 'report.pdf'), 'other session')
    mkdirSync(join(workspaceRoot, 'sessions'), { recursive: true })
    symlinkSync(other.root, join(workspaceRoot, 'sessions', 'session-a'))

    await expect(store.forSession('session-a')).rejects.toMatchObject({
      code: 'WORKSPACE_SYMLINK_REJECTED'
    })
  })
})
