import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCall, ToolExecutionContext } from '@actiondriver/runtime-contracts'
import { AgentFileStore } from '../src/agent-files/agent-file-store'
import { SkillInstaller } from '../src/agent-files/skill-installer'
import { createSkillRuntimeTools } from '../src/agent-files/runtime-tools'
import { createScriptTools } from '../src/execution/tools'
import { LoadedSkills } from '../src/computer-use/skill-gate'
import { RuntimeToolPolicy } from '../src/tool-policy'

function sessionContext(workspaceRoot: string): ToolExecutionContext {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    workspace: {
      root: workspaceRoot,
      input: join(workspaceRoot, 'input'),
      output: join(workspaceRoot, 'output')
    }
  }
}

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
    for await (const event of tool.executor.execute(
      call(modelName, args),
      undefined,
      sessionContext(homeDirectory)
    )) {
      events.push(event)
    }
    return events
  }
  return { homeDirectory, store, tools, call, collect }
}

async function collectEvents(
  tool: { executor: { execute: (call: ToolCall, signal?: AbortSignal, context?: ToolExecutionContext) => AsyncIterable<unknown> } },
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) {
  const call: ToolCall = {
    callId: 'call-1',
    providerCallId: 'provider-1',
    modelName: 'tools_local_skills_install',
    arguments: args as ToolCall['arguments']
  }
  const events: unknown[] = []
  for await (const event of tool.executor.execute(call, undefined, context)) events.push(event)
  return events
}

describe('Skill Runtime tools', () => {
  it('records the entry Skill by conversation session including an explicit SKILL.md path', async () => {
    const { homeDirectory, store, call } = await fixture()
    const loaded = new LoadedSkills()
    const tools = createSkillRuntimeTools({ store, installer: new SkillInstaller({ homeDirectory, store }), loadedSkills: loaded })
    const read = tools.find(tool => tool.definition.modelName === 'tools_local_skills_read')!
    for await (const _event of read.executor.execute(call('tools_local_skills_read', { skillId: 'skill-creator', path: 'SKILL.md' }),
      undefined, sessionContext(homeDirectory))) { /* consume the real read */ }
    expect(loaded.has('session-1', 'skill-creator')).toBe(true)
    expect(loaded.has('task-1', 'skill-creator')).toBe(false)
    expect(loaded.has('session-2', 'skill-creator')).toBe(false)
  })

  it('refuses to install a Skill that lives in another session workspace', async () => {
    const { homeDirectory, store, tools } = await fixture()
    const other = join(homeDirectory, 'output', 'sessions', 'session-b')
    const source = join(other, 'stolen-skill')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '# Stolen\n\nLeaked instructions.\n')
    const installer = tools.find((tool) => tool.definition.modelName === 'tools_local_skills_install')!
    const ownContext: ToolExecutionContext = {
      taskId: 'task-1',
      sessionId: 'session-1',
      workspace: {
        root: join(homeDirectory, 'output', 'sessions', 'session-a'),
        input: join(homeDirectory, 'output', 'sessions', 'session-a', 'input'),
        output: join(homeDirectory, 'output', 'sessions', 'session-a', 'output')
      }
    }

    await expect(
      collectEvents(installer, { source: 'local', path: source }, ownContext)
    ).rejects.toThrow()
    expect((await store.listSkills()).some((skill) => skill.id === 'stolen-skill')).toBe(false)
  })

  it('refuses a local Skill path outside the session workspace', async () => {
    const { homeDirectory, tools } = await fixture()
    const outside = join(homeDirectory, 'private-skill')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'SKILL.md'), '# Private\n\nOutside the workspace.\n')
    const installer = tools.find((tool) => tool.definition.modelName === 'tools_local_skills_install')!

    await expect(
      collectEvents(
        installer,
        { source: 'local', path: outside },
        sessionContext(join(homeDirectory, 'output'))
      )
    ).rejects.toThrow()
  })

  it('refuses a local Skill install without a trusted execution context', async () => {
    const { homeDirectory, tools } = await fixture()
    const source = join(homeDirectory, 'output', 'untrusted-skill')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '# Untrusted\n\nNo context.\n')
    const installer = tools.find((tool) => tool.definition.modelName === 'tools_local_skills_install')!

    await expect(
      collectEvents(installer, { source: 'local', path: source })
    ).rejects.toThrow('EXECUTION_CONTEXT_UNAVAILABLE')
  })

  it('reads enabled entry and references but refuses disabled and traversal paths', async () => {
    const { homeDirectory, store, tools, collect } = await fixture()
    expect(tools.map((tool) => tool.definition.modelName)).toEqual(['tools_local_skills_read', 'tools_local_skills_install'])
    const result = await collect('tools_local_skills_read', { skillId: 'skill-creator' })
    expect(JSON.stringify(result)).toContain('Skill Creator')
    await store.setSkillEnabled('skill-creator', false)
    await expect(collect('tools_local_skills_read', { skillId: 'skill-creator' })).rejects.toThrow()
    await expect(collect('tools_local_skills_read', { skillId: 'documents', path: '../main.md' })).rejects.toThrow()
    await writeFile(join(homeDirectory, '.action-driver', 'skills', '.system', 'documents', 'references', 'large.md'),
      'x'.repeat(1024 * 1024 + 1))
    await expect(collect('tools_local_skills_read', { skillId: 'documents', path: 'references/large.md' }))
      .rejects.toThrow()
  })

  it('installs a local Skill through the same directory service', async () => {
    const { homeDirectory, store, collect } = await fixture()
    const source = join(homeDirectory, 'source', 'writer')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '# Writer\n\nWrite concise notes.\n')
    const result = await collect('tools_local_skills_install', { source: 'local', path: source })
    expect(JSON.stringify(result)).toContain('writer')
    expect((await store.listSkills()).some((skill) => skill.id === 'writer')).toBe(true)
  })

  it('does not grant tools described by an installed Skill', async () => {
    const { homeDirectory, store, tools, call, collect } = await fixture()
    const source = join(homeDirectory, 'source', 'shell-guide')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '# Shell Guide\n\nUse tools_local_command_shell_run for every task.\n')
    await collect('tools_local_skills_install', { source: 'local', path: source })

    const scriptTools = await createScriptTools({
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
    })
    const shell = scriptTools.find((tool) => tool.definition.modelName === 'tools_local_command_shell_run')!
    const policy = new RuntimeToolPolicy()
    const grants = ['tools/local/skills/install@1', 'tools/local/skills/read@1']
    expect((await store.listEnabledSkillDescriptions()).some((skill) => skill.skillId === 'shell-guide'))
      .toBe(true)
    expect(policy.discover([...tools.map((tool) => tool.definition), shell.definition], { grants })
      .map((definition) => definition.modelName)).toEqual(['tools_local_skills_read', 'tools_local_skills_install'])
    expect(policy.decide(shell.definition, call('tools_local_command_shell_run', { script: 'pwd' }), { grants }))
      .toMatchObject({ kind: 'deny', error: { code: 'TOOL_DENIED' } })
  })

  it('creates an instruction Skill with the bundled Python tool and installs it', async () => {
    const { homeDirectory, store, collect } = await fixture()
    const scriptTools = await createScriptTools({
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
    })
    const python = scriptTools.find((tool) => tool.definition.modelName === 'tools_local_command_python_run')!
    const source = join(homeDirectory, 'output', 'created-skill')
    const call: ToolCall = {
      callId: 'create-skill', providerCallId: 'create-skill', modelName: 'tools_local_command_python_run',
      arguments: {
        script: 'from pathlib import Path\np = Path("output/created-skill")\np.mkdir(parents=True, exist_ok=True)\n(p / "SKILL.md").write_text("# Created Skill\\n\\nHelp with notes.\\n")',
        args: []
      }
    }
    for await (const event of python.executor.execute(call, undefined, sessionContext(homeDirectory))) {
      void event
    }
    await collect('tools_local_skills_install', { source: 'local', path: source })
    expect((await store.listSkills()).find((skill) => skill.id === 'created-skill'))
      .toMatchObject({ source: 'local', enabled: true, available: true })
    expect((await store.readEnabledSkillFile('created-skill')).content).toContain('Help with notes.')
  })
})
