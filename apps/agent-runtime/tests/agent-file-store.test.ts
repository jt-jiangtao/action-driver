import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentFileStore } from '../src/agent-files/agent-file-store'

describe('Runtime Agent file ownership', () => {
  it('migrates edited built-in Skills into .system without losing content or disabled state', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-system-migrate-'))
    const oldDirectory = join(homeDirectory, '.action-driver', 'skills', 'browser-tools')
    await mkdir(oldDirectory, { recursive: true })
    await writeFile(join(oldDirectory, 'SKILL.md'), '# Browser custom\n\nMy instructions.\n')
    await writeFile(join(oldDirectory, '.disabled'), 'disabled\n')
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    const systemPath = join(homeDirectory, '.action-driver', 'skills', '.system', 'browser-tools', 'SKILL.md')
    expect(await readFile(systemPath, 'utf8')).toBe('# Browser custom\n\nMy instructions.\n')
    expect((await store.listSkills()).find((skill) => skill.id === 'browser-tools')).toMatchObject({
      protected: true, source: 'builtin', enabled: false
    })
    expect((await store.listSkills()).some((skill) => skill.id === 'skill-creator')).toBe(true)
    await store.setSkillEnabled('browser-tools', true)
    await expect(store.deleteSkill('browser-tools')).rejects.toThrow()
    await expect(store.renameSkill('browser-tools', 'another')).rejects.toThrow()
    const file = await store.readFile('.action-driver/skills/.system/browser-tools/SKILL.md')
    await expect(store.saveFile({ path: file.path, content: 'overwrite', expectedDigest: file.digest })).rejects.toThrow()
  })

  it('preserves both old and new system content when migration target already exists', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-system-conflict-'))
    const skillsRoot = join(homeDirectory, '.action-driver', 'skills')
    await mkdir(join(skillsRoot, 'browser-tools'), { recursive: true })
    await mkdir(join(skillsRoot, '.system', 'browser-tools'), { recursive: true })
    await writeFile(join(skillsRoot, 'browser-tools', 'SKILL.md'), '# Old\n\nLegacy.\n')
    await writeFile(join(skillsRoot, '.system', 'browser-tools', 'SKILL.md'), '# New\n\nSystem.\n')
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    await store.initialize()
    expect(await readFile(join(skillsRoot, '.system', 'browser-tools', 'SKILL.md'), 'utf8')).toContain('System.')
    expect(await readFile(join(skillsRoot, 'browser-tools-legacy', 'SKILL.md'), 'utf8')).toContain('Legacy.')
    expect((await readdir(skillsRoot)).filter((name) => name.startsWith('browser-tools-legacy'))).toEqual(['browser-tools-legacy'])
  })

  it('enables and reads an ordinary Skill without an executor, then respects disabling', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-ordinary-skill-'))
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    const directory = join(homeDirectory, '.action-driver', 'skills', 'plain')
    await mkdir(join(directory, 'references'), { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '# Plain\n\nHelps with notes.\n')
    await writeFile(join(directory, 'references', 'usage.md'), 'Use short notes.')
    await symlink(join(homeDirectory, '.action-driver', 'skills', 'report-writer', 'SKILL.md'),
      join(directory, 'references', 'foreign.md'))

    expect(await store.listSkills()).toContainEqual(expect.objectContaining({
      id: 'plain', source: 'local', available: true, enabled: true
    }))
    expect(await store.listEnabledSkillDescriptions()).toContainEqual({
      skillId: 'plain', description: 'Helps with notes.'
    })
    expect((await store.readEnabledSkillFile('plain', 'references/usage.md')).content).toBe('Use short notes.')
    await expect(store.readEnabledSkillFile('plain', '../other')).rejects.toThrow()
    await expect(store.readEnabledSkillFile('plain', 'references/foreign.md')).rejects.toThrow()
    await store.setSkillEnabled('plain', false)
    await expect(store.readEnabledSkillFile('plain')).rejects.toThrow()
    const second = new AgentFileStore({ homeDirectory })
    await second.initialize()
    expect((await second.listSkills()).find((skill) => skill.id === 'plain')?.enabled).toBe(false)
  })

  it('keeps an existing prompt and Skill definition intact across repeated initialization', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-agent-files-'))
    const first = new AgentFileStore({ homeDirectory })
    await first.initialize()
    const original = await first.getMainPrompt()
    await first.saveFile({ path: original.path, content: '# Custom prompt', expectedDigest: original.digest })
    const second = new AgentFileStore({ homeDirectory })
    await second.initialize()
    expect((await second.getMainPrompt()).content).toBe('# Custom prompt')
    expect((await second.listSkills()).map((skill) => skill.id)).toEqual([
      'browser-tools', 'computer-tools', 'report-writer', 'skill-creator'
    ])
  })
})
