import { describe, expect, it } from 'vitest'
import { cp, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentFileStore } from '../src/agent-files/agent-file-store'
import { SkillInstaller } from '../src/agent-files/skill-installer'

async function fixture() {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'actiondriver-install-'))
  const store = new AgentFileStore({ homeDirectory })
  await store.initialize()
  const source = join(homeDirectory, 'source', 'plain')
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '# Plain\n\nHelps with notes.\n')
  await writeFile(join(source, 'references', 'usage.md'), 'Use short notes.')
  return { homeDirectory, store, source, installer: new SkillInstaller({ homeDirectory, store }) }
}

describe('SkillInstaller local source', () => {
  it('copies a complete snapshot and rejects duplicate without altering it', async () => {
    const { homeDirectory, store, source, installer } = await fixture()
    const installed = await installer.installSkill({ source: 'local', path: source })
    expect(installed).toMatchObject({ id: 'plain', source: 'local', available: true, enabled: true })
    const restarted = new AgentFileStore({ homeDirectory })
    await restarted.initialize()
    expect((await restarted.listSkills()).find((skill) => skill.id === 'plain')?.source).toBe('local')
    expect((await store.readEnabledSkillFile('plain', 'references/usage.md')).content).toBe('Use short notes.')
    await writeFile(join(source, 'references', 'usage.md'), 'Changed at source.')
    await expect(installer.installSkill({ source: 'local', path: source })).rejects.toThrow('已存在')
    expect(await readFile(join(homeDirectory, '.action-driver', 'skills', 'plain', 'references', 'usage.md'), 'utf8')).toBe('Use short notes.')
  })

  it('rejects invalid source content and leaves no partial Skill directory', async () => {
    const { homeDirectory, source, installer } = await fixture()
    await symlink('/etc/hosts', join(source, 'references', 'outside'))
    await expect(installer.installSkill({ source: 'local', path: source })).rejects.toThrow()
    const root = join(homeDirectory, '.action-driver', 'skills')
    expect(await readdir(root)).not.toContain('plain')
    expect((await readdir(root)).some((name) => name.startsWith('.install-'))).toBe(false)
  })

  it('rejects its own destination, missing entry, and oversized content', async () => {
    const { homeDirectory, source, installer } = await fixture()
    const dest = join(homeDirectory, '.action-driver', 'skills', 'plain')
    await expect(installer.installSkill({ source: 'local', path: dest })).rejects.toThrow()
    const missing = join(homeDirectory, 'source', 'missing')
    await mkdir(missing)
    await expect(installer.installSkill({ source: 'local', path: missing })).rejects.toThrow()
    await writeFile(join(source, 'references', 'large.txt'), 'x'.repeat(11 * 1024 * 1024))
    await expect(installer.installSkill({ source: 'local', path: source })).rejects.toThrow()
    expect(await readdir(join(homeDirectory, '.action-driver', 'skills'))).not.toContain('plain')
  })

  it('reserves system Skill names for bundled content', async () => {
    const { homeDirectory, installer } = await fixture()
    for (const id of ['skill-creator', 'documents', 'pdf', 'presentations', 'spreadsheets']) {
      const source = join(homeDirectory, 'source', id)
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'SKILL.md'), '# Replacement\n\nShould not install.\n')
      await expect(installer.installSkill({ source: 'local', path: source })).rejects.toThrow()
      expect(await readdir(join(homeDirectory, '.action-driver', 'skills'))).not.toContain(id)
    }
  })

  it('uses the same validation and persistent source label for GitHub imports', async () => {
    const { homeDirectory, source, store } = await fixture()
    const installer = new SkillInstaller({
      homeDirectory, store,
      fetchGithub: async (_location, destination) => { await cp(source, destination, { recursive: true }) }
    })
    const installed = await installer.installSkill({ source: 'github', url: 'https://github.com/acme/tools/tree/main/skills/plain' })
    expect(installed).toMatchObject({ id: 'plain', source: 'github' })
    const restarted = new AgentFileStore({ homeDirectory })
    await restarted.initialize()
    expect((await restarted.listSkills()).find((skill) => skill.id === 'plain')?.source).toBe('github')
  })

  it('does not replace an installed Skill when GitHub fetch fails or duplicates its name', async () => {
    const { homeDirectory, source, store } = await fixture()
    const failing = new SkillInstaller({
      homeDirectory, store,
      fetchGithub: async () => { throw new Error('network down') }
    })
    const url = 'https://github.com/acme/tools/tree/main/skills/plain'
    await expect(failing.installSkill({ source: 'github', url })).rejects.toThrow('network down')
    expect(await readdir(join(homeDirectory, '.action-driver', 'skills'))).not.toContain('plain')
    const working = new SkillInstaller({
      homeDirectory, store,
      fetchGithub: async (_location, destination) => { await cp(source, destination, { recursive: true }) }
    })
    await working.installSkill({ source: 'github', url })
    await expect(working.installSkill({ source: 'github', url })).rejects.toThrow('已存在')
    expect(await readFile(join(homeDirectory, '.action-driver', 'skills', 'plain', 'SKILL.md'), 'utf8'))
      .toContain('Helps with notes.')
  })
})
