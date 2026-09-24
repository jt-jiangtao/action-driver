import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCall } from '@actiondriver/runtime-contracts'
import { AgentFileStore } from '../src/agent-files/agent-file-store'
import { SkillInstaller } from '../src/agent-files/skill-installer'
import { createSkillRuntimeTools } from '../src/agent-files/runtime-tools'
import { createScriptTools } from '../src/execution/tools'
import { RuntimeToolPolicy } from '../src/tool-policy'

async function fixture() {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'actiondriver-skill-tool-'))
  const store = new AgentFileStore({ homeDirectory })
  await store.initialize()
  const installer = new SkillInstaller({ homeDirectory, store })
  const tools = createSkillRuntimeTools({ store, installer })
  const call = (modelName: string, args: Record<string, unknown>): ToolCall => ({
    callId: 'call-1', providerCallId: 'provider-1', modelName, arguments: args as ToolCall['arguments']
  })
  const collect = async (modelName: string, args: Record<string, unknown>) => {
    const tool = tools.find((entry) => entry.definition.modelName === modelName)!
    const events = []
    for await (const event of tool.executor.execute(call(modelName, args))) events.push(event)
    return events
  }
  return { homeDirectory, store, tools, call, collect }
}

describe('Skill Runtime tools', () => {
  it('reads enabled entry and references but refuses disabled and traversal paths', async () => {
    const { homeDirectory, store, tools, collect } = await fixture()
    expect(tools.map((tool) => tool.definition.modelName)).toEqual(['skill_read', 'skill_install'])
    const result = await collect('skill_read', { skillId: 'skill-creator' })
    expect(JSON.stringify(result)).toContain('Skill Creator')
    await store.setSkillEnabled('skill-creator', false)
    await expect(collect('skill_read', { skillId: 'skill-creator' })).rejects.toThrow()
    await expect(collect('skill_read', { skillId: 'browser-tools', path: '../main.md' })).rejects.toThrow()
    await writeFile(join(homeDirectory, '.action-driver', 'skills', '.system', 'browser-tools', 'references', 'large.md'),
      'x'.repeat(1024 * 1024 + 1))
    await expect(collect('skill_read', { skillId: 'browser-tools', path: 'references/large.md' }))
      .rejects.toThrow()
  })

  it('installs a local Skill through the same directory service', async () => {
    const { homeDirectory, store, collect } = await fixture()
    const source = join(homeDirectory, 'source', 'writer')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '# Writer\n\nWrite concise notes.\n')
    const result = await collect('skill_install', { source: 'local', path: source })
    expect(JSON.stringify(result)).toContain('writer')
    expect((await store.listSkills()).some((skill) => skill.id === 'writer')).toBe(true)
  })

  it('does not grant tools described by an installed Skill', async () => {
    const { homeDirectory, store, tools, call, collect } = await fixture()
    const source = join(homeDirectory, 'source', 'shell-guide')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '# Shell Guide\n\nUse shell_run for every task.\n')
    await collect('skill_install', { source: 'local', path: source })

    const scriptTools = await createScriptTools({
      workspaceRoot: homeDirectory,
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
    })
    const shell = scriptTools.find((tool) => tool.definition.modelName === 'shell_run')!
    const policy = new RuntimeToolPolicy()
    const grants = ['skill.install@1', 'skill.read@1']
    expect((await store.listEnabledSkillDescriptions()).some((skill) => skill.skillId === 'shell-guide'))
      .toBe(true)
    expect(policy.discover([...tools.map((tool) => tool.definition), shell.definition], { grants })
      .map((definition) => definition.modelName)).toEqual(['skill_read', 'skill_install'])
    expect(policy.decide(shell.definition, call('shell_run', { script: 'pwd' }), { grants }))
      .toMatchObject({ kind: 'deny', error: { code: 'TOOL_DENIED' } })
  })

  it('creates an instruction Skill with the bundled Python tool and installs it', async () => {
    const { homeDirectory, store, collect } = await fixture()
    const scriptTools = await createScriptTools({
      workspaceRoot: homeDirectory,
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
    })
    const python = scriptTools.find((tool) => tool.definition.modelName === 'python_run')!
    const source = join(homeDirectory, 'created-skill')
    const call: ToolCall = {
      callId: 'create-skill', providerCallId: 'create-skill', modelName: 'python_run',
      arguments: {
        script: 'from pathlib import Path\nimport sys\np = Path(sys.argv[1]); p.mkdir(); (p / "SKILL.md").write_text("# Created Skill\\n\\nHelp with notes.\\n")',
        args: [source]
      }
    }
    for await (const event of python.executor.execute(call)) { void event }
    await collect('skill_install', { source: 'local', path: source })
    expect((await store.listSkills()).find((skill) => skill.id === 'created-skill'))
      .toMatchObject({ source: 'local', enabled: true, available: true })
    expect((await store.readEnabledSkillFile('created-skill')).content).toContain('Help with notes.')
  })
})
