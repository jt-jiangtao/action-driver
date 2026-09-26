import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentFileStore } from '../src/agent-files/agent-file-store'

describe('Runtime Agent file ownership', () => {
  it('removes retired system copies while preserving personal and legacy Skills', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-system-retire-'))
    const skillsRoot = join(homeDirectory, '.action-driver', 'skills')
    await mkdir(join(skillsRoot, 'browser-tools'), { recursive: true })
    await mkdir(join(skillsRoot, 'computer-tools-legacy'), { recursive: true })
    await writeFile(join(skillsRoot, 'browser-tools', 'SKILL.md'), '# Personal\n\nKeep me.\n')
    await writeFile(join(skillsRoot, 'computer-tools-legacy', 'SKILL.md'), '# Legacy\n\nKeep me.\n')
    for (const id of ['browser-tools', 'computer-tools', 'report-writer']) {
      const root = join(skillsRoot, '.system', id)
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'SKILL.md'), `# ${id}\n\nDelete me.\n`)
    }
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    await store.initialize()
    expect(await readFile(join(skillsRoot, 'browser-tools', 'SKILL.md'), 'utf8')).toContain('Keep me.')
    expect(await readFile(join(skillsRoot, 'computer-tools-legacy', 'SKILL.md'), 'utf8')).toContain('Keep me.')
    for (const id of ['browser-tools', 'computer-tools', 'report-writer']) {
      expect(await readdir(join(skillsRoot, '.system'))).not.toContain(id)
    }
    expect((await store.listSkills()).find((skill) => skill.id === 'browser-tools')).toMatchObject({ source: 'local' })
  })

  it('seeds every skill-creator resource and restores missing files without replacing the entry', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-skill-creator-'))
    const root = join(homeDirectory, '.action-driver', 'skills', '.system', 'skill-creator')
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    for (const path of [
      'scripts/init_skill.py', 'scripts/quick_validate.py', 'scripts/generate_openai_yaml.py',
      'references/openai_yaml.md', 'agents/openai.yaml',
      'assets/skill-creator-small.svg', 'assets/skill-creator.png', 'license.txt'
    ]) {
      expect((await readFile(join(root, path))).length).toBeGreaterThan(0)
    }
    await writeFile(join(root, 'SKILL.md'), '# Customized creator\n')
    await rm(join(root, 'scripts', 'quick_validate.py'))
    await store.initialize()
    expect(await readFile(join(root, 'SKILL.md'), 'utf8')).toBe('# Customized creator\n')
    expect((await readFile(join(root, 'scripts', 'quick_validate.py'))).length).toBeGreaterThan(0)
  })

  it('installs the complete imagegen system Skill and keeps it read-only', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-imagegen-'))
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    const root = join(homeDirectory, '.action-driver', 'skills', '.system', 'imagegen')
    for (const path of [
      'SKILL.md', 'LICENSE.txt', 'agents/openai.yaml', 'assets/imagegen-small.svg',
      'assets/imagegen.png', 'references/cli.md', 'references/codex-network.md',
      'references/image-api.md', 'references/prompting.md', 'references/sample-prompts.md',
      'scripts/image_gen.py', 'scripts/remove_chroma_key.py'
    ]) expect((await readFile(join(root, path))).length).toBeGreaterThan(0)
    const installedSkill = await readFile(join(root, 'SKILL.md'), 'utf8')
    expect(installedSkill).toContain('image.generate')
    expect(installedSkill).toContain('1–16')
    expect(installedSkill).toContain('more than 16')
    expect((await store.listSkills()).find((skill) => skill.id === 'imagegen')).toMatchObject({ protected: true, source: 'builtin' })
    const skill = await store.readFile('.action-driver/skills/.system/imagegen/SKILL.md')
    await expect(store.saveFile({ path: skill.path, content: 'edit', expectedDigest: skill.digest })).rejects.toThrow()
    await expect(store.deleteSkill('imagegen')).rejects.toThrow()
    await store.setSkillEnabled('imagegen', false)
    await store.initialize()
    expect((await store.listSkills()).find((entry) => entry.id === 'imagegen')?.enabled).toBe(false)
  })

  it('seeds and protects all four office document Skills without overwriting user state', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-office-skills-'))
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    for (const id of ['documents', 'pdf', 'presentations', 'spreadsheets']) {
      const root = join(homeDirectory, '.action-driver', 'skills', '.system', id)
      expect((await readFile(join(root, 'SKILL.md'))).length).toBeGreaterThan(0)
      expect((await store.listSkills()).find((skill) => skill.id === id)).toMatchObject({
        protected: true, source: 'builtin', enabled: true
      })
      const entry = await store.readFile(`.action-driver/skills/.system/${id}/SKILL.md`)
      await expect(store.saveFile({ path: entry.path, content: 'edit', expectedDigest: entry.digest })).rejects.toThrow()
      await expect(store.renameSkill(id, `renamed-${id}`)).rejects.toThrow()
      await expect(store.deleteSkill(id)).rejects.toThrow()
      await store.setSkillEnabled(id, false)
    }
    const customized = join(homeDirectory, '.action-driver', 'skills', '.system', 'documents', 'SKILL.md')
    await writeFile(customized, '# Preserved content\n')
    const restarted = new AgentFileStore({ homeDirectory })
    await restarted.initialize()
    expect(await readFile(customized, 'utf8')).toBe('# Preserved content\n')
    for (const id of ['documents', 'pdf', 'presentations', 'spreadsheets']) {
      expect((await restarted.listSkills()).find((skill) => skill.id === id)?.enabled).toBe(false)
    }
  })

  it('enables and reads an ordinary Skill without an executor, then respects disabling', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-ordinary-skill-'))
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    const directory = join(homeDirectory, '.action-driver', 'skills', 'plain')
    await mkdir(join(directory, 'references'), { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '# Plain\n\nHelps with notes.\n')
    await writeFile(join(directory, 'references', 'usage.md'), 'Use short notes.')
    await symlink(join(homeDirectory, '.action-driver', 'skills', '.system', 'skill-creator', 'SKILL.md'),
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
      'computer-use', 'documents', 'imagegen', 'pdf', 'presentations', 'skill-creator',
      'spreadsheets'
    ])
  })

  it('replaces a superseded default prompt but never a customized one', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-agent-prompt-refresh-'))
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()
    const path = join(homeDirectory, '.action-driver', 'prompts', 'main.md')
    writeFileSync(
      path,
      `# ActionDriver 主提示词

你是 ActionDriver 的执行助手。你的职责是准确理解用户目标，在当前可用能力范围内完成任务，并返回可验证的结果。

## 工作原则

- 先识别用户目标、约束和成功标准；信息不足且会影响结果时，只提出必要的澄清问题。
- 能直接执行时立即行动，不重复确认，不输出内部执行进度。
- 只陈述已知事实、实际执行的操作和真实结果；不得虚构工具调用、外部结果或完成状态。
- 遇到不确定性时，明确说明假设、限制和风险；无法继续时说明具体阻塞点。
- 保持任务边界，不擅自扩大范围或执行无关操作。
- 优先给出结果，使用简洁、清晰的 Markdown；只有在有助于理解时才补充过程或细节。
`
    )

    await new AgentFileStore({ homeDirectory }).initialize()

    const refreshed = await store.getMainPrompt()
    expect(refreshed.content).toContain('把目标做完再交付')
    expect(refreshed.content).toContain('output/')

    await store.saveFile({ path: refreshed.path, content: '# 我自己的提示词', expectedDigest: refreshed.digest })
    await new AgentFileStore({ homeDirectory }).initialize()
    expect((await store.getMainPrompt()).content).toBe('# 我自己的提示词')
  })

  it('seeds the main prompt from the packaged prompt resource', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-agent-prompt-resource-'))
    const store = new AgentFileStore({ homeDirectory })
    await store.initialize()

    const resource = await readFile(
      join(process.cwd(), 'apps/agent-runtime/resources/prompts/main.md'),
      'utf8'
    )
    expect((await store.getMainPrompt()).content).toBe(resource)
  })
})
