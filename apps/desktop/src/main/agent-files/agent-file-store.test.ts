import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentFileStore, AgentFileStoreError } from './agent-file-store'

const temporaryDirectories: string[] = []

async function createStore(registeredExecutors = new Set(['browser-use', 'computer-use'])) {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'actiondriver-agent-files-'))
  temporaryDirectories.push(homeDirectory)
  const store = new AgentFileStore({
    homeDirectory,
    isExecutorRegistered: (executorId) => registeredExecutors.has(executorId)
  })
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

    const restarted = new AgentFileStore({
      homeDirectory,
      isExecutorRegistered: (executorId) =>
        executorId === 'browser-use' || executorId === 'computer-use'
    })
    await restarted.initialize()

    expect((await restarted.getMainPrompt()).content).toBe('# Custom prompt')
    expect((await restarted.listSkills()).map((skill) => skill.name)).toEqual([
      'browser-tools',
      'computer-tools',
      'report-writer'
    ])
  })

  it('maps Skill declarations to registered executors without treating directory names as executors', async () => {
    const { store } = await createStore()

    expect(await store.listSkills()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'browser-tools',
          executorId: 'browser-use',
          available: true,
          unavailableReason: null
        }),
        expect.objectContaining({
          id: 'computer-tools',
          executorId: 'computer-use',
          available: true,
          unavailableReason: null
        }),
        expect.objectContaining({
          id: 'report-writer',
          executorId: null,
          enabled: false,
          available: false,
          unavailableReason: 'missing-executor'
        })
      ])
    )
  })

  it('migrates only an untouched legacy built-in declaration to explicit executor frontmatter', async () => {
    const { homeDirectory } = await createStore()
    const path = join(homeDirectory, '.action-driver', 'skills', 'browser-tools', 'SKILL.md')
    await writeFile(
      path,
      '# browser-tools\n\n通过浏览器搜索、读取并整理网页信息。\n\n## Usage\n\n当任务匹配该能力时使用。\n'
    )

    const restarted = new AgentFileStore({
      homeDirectory,
      isExecutorRegistered: (executorId) => executorId === 'browser-use'
    })
    await restarted.initialize()

    expect(await readFile(path, 'utf8')).toContain('executor: browser-use')
    expect((await restarted.listSkills()).find((skill) => skill.id === 'browser-tools')).toMatchObject({
      available: true,
      executorId: 'browser-use'
    })
  })

  it('does not overwrite a user-edited built-in declaration during executor migration', async () => {
    const { homeDirectory } = await createStore()
    const path = join(homeDirectory, '.action-driver', 'skills', 'browser-tools', 'SKILL.md')
    await writeFile(path, '# browser-tools\n\n用户自定义内容。\n')

    const restarted = new AgentFileStore({
      homeDirectory,
      isExecutorRegistered: (executorId) => executorId === 'browser-use'
    })
    await restarted.initialize()

    expect(await readFile(path, 'utf8')).toBe('# browser-tools\n\n用户自定义内容。\n')
    expect((await restarted.listSkills()).find((skill) => skill.id === 'browser-tools')).toMatchObject({
      available: false,
      executorId: null,
      unavailableReason: 'missing-executor'
    })
  })

  it('keeps unknown executors unavailable and rejects enabling or invoking them', async () => {
    const { store } = await createStore()
    const created = await store.createSkill({ name: 'release-helper', description: '整理发布记录' })
    const skillFile = await store.readFile(`.action-driver/skills/${created.id}/SKILL.md`)
    await store.saveFile({
      path: skillFile.path,
      content: '---\nexecutor: release-use\n---\n# release-helper\n\n整理发布记录\n',
      expectedDigest: skillFile.digest
    })

    expect((await store.listSkills()).find((skill) => skill.id === created.id)).toMatchObject({
      executorId: 'release-use',
      enabled: false,
      available: false,
      unavailableReason: 'executor-unregistered'
    })
    await expect(store.setSkillEnabled(created.id, true)).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    await expect(store.assertExecutorEnabled('release-use')).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE: release-use'
    )
  })

  it.each([
    ['nested metadata', '---\nmetadata:\n  executor: browser-use\n---\n# unsafe\n'],
    ['block scalar content', '---\nnotes: |\n  executor: browser-use\n---\n# unsafe\n'],
    [
      'duplicate executor keys',
      '---\nexecutor: browser-use\nexecutor: computer-use\n---\n# unsafe\n'
    ],
    ['invalid opening boundary', '---not-frontmatter\nexecutor: browser-use\n---\n# unsafe\n']
  ])('does not authorize %s as a top-level executor declaration', async (_name, content) => {
    const { store } = await createStore()
    const created = await store.createSkill({ name: 'unsafe-skill', description: 'unsafe' })
    const skillFile = await store.readFile(`.action-driver/skills/${created.id}/SKILL.md`)
    await store.saveFile({ path: skillFile.path, content, expectedDigest: skillFile.digest })

    expect((await store.listSkills()).find((skill) => skill.id === created.id)).toMatchObject({
      executorId: null,
      enabled: false,
      available: false,
      unavailableReason: 'invalid-executor'
    })
    await expect(store.assertExecutorEnabled('browser-use')).resolves.toBeUndefined()
  })

  it('accepts one top-level executor string with a YAML line comment', async () => {
    const { store } = await createStore()
    const created = await store.createSkill({ name: 'browser-helper', description: '浏览器助手' })
    const skillFile = await store.readFile(`.action-driver/skills/${created.id}/SKILL.md`)
    await store.saveFile({
      path: skillFile.path,
      content: '---\nexecutor: browser-use # registered browser executor\n---\n# browser-helper\n',
      expectedDigest: skillFile.digest
    })

    expect((await store.listSkills()).find((skill) => skill.id === created.id)).toMatchObject({
      executorId: 'browser-use',
      available: true
    })
  })

  it('blocks direct execution immediately after a mapped Skill is disabled', async () => {
    const { store } = await createStore()

    await expect(store.assertExecutorEnabled('browser-use')).resolves.toBeUndefined()
    await store.setSkillEnabled('browser-tools', false)
    await expect(store.assertExecutorEnabled('browser-use')).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE: browser-use'
    )
  })

  it('persists built-in execution state across restart and restores access when re-enabled', async () => {
    const { store, homeDirectory } = await createStore()
    await store.setSkillEnabled('browser-tools', false)

    const restarted = new AgentFileStore({
      homeDirectory,
      isExecutorRegistered: (executorId) => executorId === 'browser-use'
    })
    await restarted.initialize()

    expect((await restarted.getEnabledExecutors()).map((skill) => skill.skillId)).not.toContain(
      'browser-use'
    )
    await expect(restarted.assertExecutorEnabled('browser-use')).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE: browser-use'
    )

    await restarted.setSkillEnabled('browser-tools', true)
    expect((await restarted.getEnabledExecutors()).map((skill) => skill.skillId)).toContain(
      'browser-use'
    )
    await expect(restarted.assertExecutorEnabled('browser-use')).resolves.toBeUndefined()
  })

  it('deduplicates multiple declarations that map to the same executor', async () => {
    const { store } = await createStore()
    const created = await store.createSkill({ name: 'browser-shortcuts', description: '浏览器快捷操作' })
    const skillFile = await store.readFile(`.action-driver/skills/${created.id}/SKILL.md`)
    await store.saveFile({
      path: skillFile.path,
      content: '---\nexecutor: browser-use\n---\n# browser-shortcuts\n\n浏览器快捷操作\n',
      expectedDigest: skillFile.digest
    })
    await store.setSkillEnabled(created.id, true)

    expect((await store.getEnabledExecutors()).filter((skill) => skill.skillId === 'browser-use')).toEqual([
      { skillId: 'browser-use', description: '通过浏览器搜索、读取并整理网页信息。' }
    ])
  })

  it('isolates an incomplete Skill directory from healthy task snapshots and authorization', async () => {
    const { store, homeDirectory } = await createStore()
    await mkdir(join(homeDirectory, '.action-driver', 'skills', 'incomplete-import'))

    expect((await store.listSkills()).find((skill) => skill.id === 'incomplete-import')).toMatchObject({
      enabled: false,
      available: false,
      executorId: null,
      unavailableReason: 'invalid-declaration'
    })
    expect((await store.getEnabledExecutors()).map((skill) => skill.skillId)).toEqual([
      'browser-use',
      'computer-use'
    ])
    await expect(store.assertExecutorEnabled('computer-use')).resolves.toBeUndefined()
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

    const restarted = new AgentFileStore({
      homeDirectory,
      isExecutorRegistered: (executorId) =>
        executorId === 'browser-use' || executorId === 'computer-use'
    })
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

    const restarted = new AgentFileStore({
      homeDirectory,
      isExecutorRegistered: (executorId) =>
        executorId === 'browser-use' || executorId === 'computer-use'
    })
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
