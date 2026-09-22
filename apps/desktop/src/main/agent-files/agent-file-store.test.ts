import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentFileStore, AgentFileStoreError } from './agent-file-store'

const temporaryDirectories: string[] = []

async function createStore() {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'actiondriver-agent-files-'))
  temporaryDirectories.push(homeDirectory)
  const store = new AgentFileStore({ homeDirectory })
  await store.initialize()
  return { store, homeDirectory }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('AgentFileStore', () => {
  it('seeds missing files once and restores existing content after restart', async () => {
    const { store, homeDirectory } = await createStore()
    const prompt = await store.getMainPrompt()
    await store.saveFile({
      path: prompt.path,
      content: '# Custom prompt',
      expectedDigest: prompt.digest
    })

    const restarted = new AgentFileStore({ homeDirectory })
    await restarted.initialize()

    expect((await restarted.getMainPrompt()).content).toBe('# Custom prompt')
    expect((await restarted.listSkills()).map((skill) => skill.name)).toEqual([
      'browser-tools',
      'report-writer'
    ])
  })

  it('rejects traversal, absolute paths, and symlinks that leave the managed root', async () => {
    const { store, homeDirectory } = await createStore()
    const outside = join(homeDirectory, 'outside.txt')
    await writeFile(outside, 'secret')
    await symlink(
      outside,
      join(homeDirectory, '.action-driver', 'skills', 'browser-tools', 'escape.md')
    )

    await expect(store.readFile('../outside.txt')).rejects.toMatchObject({ code: 'PATH_REJECTED' })
    await expect(store.readFile(outside)).rejects.toMatchObject({ code: 'PATH_REJECTED' })
    await expect(
      store.readFile('.action-driver/skills/browser-tools/escape.md')
    ).rejects.toMatchObject({ code: 'PATH_REJECTED' })
  })

  it('saves atomically and reports digest conflicts without overwriting external edits', async () => {
    const { store, homeDirectory } = await createStore()
    const prompt = await store.getMainPrompt()
    const absolutePrompt = join(homeDirectory, prompt.path)
    await writeFile(absolutePrompt, '# External edit')

    await expect(
      store.saveFile({ path: prompt.path, content: '# Stale write', expectedDigest: prompt.digest })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(absolutePrompt, 'utf8')).toBe('# External edit')
  })

  it('restores the built-in main prompt through the same digest conflict guard', async () => {
    const { store } = await createStore()
    const original = await store.getMainPrompt()
    const customized = await store.saveFile({
      path: original.path,
      content: '# Custom prompt',
      expectedDigest: original.digest
    })

    const restored = await store.resetMainPrompt(customized.digest)
    expect(restored.content).toContain('# ActionDriver 主提示词')
    await expect(store.resetMainPrompt(customized.digest)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
  })

  it('persists a created Skill edit across restart, detects an external conflict, then deletes it', async () => {
    const { store, homeDirectory } = await createStore()
    const created = await store.createSkill({ name: 'release-helper', description: '整理发布记录' })
    const publicPath = `.action-driver/skills/${created.id}/SKILL.md`
    const initial = await store.readFile(publicPath)
    await store.saveFile({
      path: publicPath,
      content: '# release-helper\n\n生成发布说明。\n',
      expectedDigest: initial.digest
    })

    const restarted = new AgentFileStore({ homeDirectory })
    await restarted.initialize()
    const persisted = await restarted.readFile(publicPath)
    expect(persisted.content).toContain('生成发布说明')

    await writeFile(join(homeDirectory, publicPath), '# External edit')
    await expect(
      restarted.saveFile({
        path: publicPath,
        content: '# Stale edit',
        expectedDigest: persisted.digest
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    await restarted.deleteSkill(created.id)
    expect((await restarted.listSkills()).some((skill) => skill.id === created.id)).toBe(false)
  })

  it('creates, renames, toggles, enumerates, and deletes an editable skill', async () => {
    const { store, homeDirectory } = await createStore()
    const created = await store.createSkill({ name: 'release-helper', description: '整理发布记录' })
    expect((await store.getSkillTree(created.id)).map((node) => node.name)).toContain('SKILL.md')

    const renamed = await store.renameSkill(created.id, 'release-notes')
    expect(renamed.name).toBe('release-notes')
    expect((await store.setSkillEnabled(renamed.id, false)).enabled).toBe(false)

    const restarted = new AgentFileStore({ homeDirectory })
    await restarted.initialize()
    expect((await restarted.listSkills()).find((skill) => skill.id === renamed.id)?.enabled).toBe(
      false
    )

    await restarted.deleteSkill(renamed.id)
    expect((await restarted.listSkills()).some((skill) => skill.id === renamed.id)).toBe(false)
  })

  it('protects built-in skills from destructive operations', async () => {
    const { store } = await createStore()

    await expect(store.renameSkill('browser-tools', 'renamed')).rejects.toBeInstanceOf(
      AgentFileStoreError
    )
    await expect(store.deleteSkill('browser-tools')).rejects.toMatchObject({ code: 'PROTECTED' })
  })
})
