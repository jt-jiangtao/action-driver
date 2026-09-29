import { expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validateManifest, type PluginCatalog } from '@actiondriver/plugin-contracts'

it('ships each approved instruction capability in its owning package with every declared resource', async () => {
  const owners = { documents: 'documents', pdf: 'pdf', presentations: 'presentations', spreadsheets: 'spreadsheets', 'skill-creator': 'skills', imagegen: 'image-generation' }
  for (const [id, plugin] of Object.entries(owners)) {
    const root = resolve('plugins', plugin)
    const manifest = validateManifest(JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')), { sdk: '1.0.0', platform: `${process.platform}-${process.arch}` })
    expect(manifest.contributions).toContainEqual({ kind: 'skill', id })
    const { catalog } = await import(join(root, 'src/catalog.ts')) as { catalog: PluginCatalog }
    const skill = catalog.skills.find(item => item.id === id)!
    expect(skill.content).toBe(await readFile(join(root, 'skills', id, 'SKILL.md'), 'utf8'))
    expect(skill.resources).toContain(`skills/${id}/SKILL.md`)
    for (const resource of skill.resources) expect((await stat(join(root, resource))).isFile()).toBe(true)
  }
})
it('publishes one web catalog and hides cloud tools without credentials', async () => {
  const { createPluginContext } = await import('@actiondriver/plugin-sdk')
  const { catalog } = await import('../../../plugins/web/src/catalog')
  const { activate } = await import('../../../plugins/web/src/extension')
  expect(catalog.tools.map(tool => tool.id)).toEqual(['tools/local/web/search', 'tools/local/web/open'])
  const live = new Set<string>()
  const context = createPluginContext({ pluginId: 'web', version: '1.0.0', hostEpoch: 'test' }, {
    tools: { register(tool) { live.add(tool.id); return { dispose() { live.delete(tool.id) } } } },
    registrations: { register() { throw new Error('Unexpected registration') } },
    transport: { async request() { return null } }
  })
  await activate(context)
  expect([...live]).toEqual([])
  await context.subscriptions.dispose()
  expect(live.size).toBe(0)
})
it('loads all instruction packages through real hosts and withdraws a stopped package without disturbing others', async () => {
  const { mkdtemp, rm, readdir, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { AgentFileStore } = await import('../src/agent-files/agent-file-store')
  const { SkillInstaller } = await import('../src/agent-files/skill-installer')
  const { PluginInstructionHost } = await import('../src/plugins/instruction-host')
  const { createRuntimePluginPlatform } = await import('../src/plugins/composition')
  const { RuntimeToolRegistry } = await import('../src/tool-registry')
  const { createSkillStoragePorts } = await import('../src/plugins/skill-port')
  const home = await mkdtemp(join(tmpdir(), 'actiondriver-capability-packages-'))
  const ids = ['documents', 'pdf', 'presentations', 'spreadsheets', 'skill-creator', 'imagegen', 'computer-use']
  const instructions = new PluginInstructionHost(home, ids)
  const store = new AgentFileStore({ homeDirectory: home, pluginSkills: instructions })
  await store.initialize()
  const root = join(home, 'session'); await mkdir(root)
  const registry = new RuntimeToolRegistry()
  const packageIds = ['documents', 'pdf', 'presentations', 'spreadsheets', 'skills', 'image-generation']
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/dist/plugin-host.mjs'), packageRoots: packageIds.map(id => resolve('apps/agent-runtime/dist/plugins', id)), dataRoot: join(home, 'data'), registry, configuration: {}, now: Date.now, ids: () => String(Math.random()),
    skills: { stage: (owner, skill, packageRoot) => instructions.stage(owner, skill, packageRoot), publish: (owner, id) => instructions.publish(owner, id) },
    hostCapabilities: createSkillStoragePorts({ store, installer: new SkillInstaller({ homeDirectory: home, store }), contexts: { async resolve() { return { taskId: 'task', sessionId: 'session', workspace: { root, input: root, output: root } } } }, record() {} })
  })
  try {
    await Promise.all(packageIds.map(id => platform.enable(id)))
    expect((await store.listSkills()).map(skill => [skill.id, skill.source])).toEqual(expect.arrayContaining(ids.filter(id => id !== 'computer-use').map(id => [id, 'plugin'])))
    expect(await readdir(join(home, '.action-driver/skills/.system'))).toEqual([])
    const events = []
    for await (const event of registry.resolve('tools/local/skills/read', 1).executor.execute({ callId: 'read', providerCallId: 'p', modelName: 'tools_local_skills_read', arguments: { skillId: 'pdf' } }, new AbortController().signal, { taskId: 'task', sessionId: 'session', workspace: { root, input: root, output: root }, grants: ['tools/local/skills/read@1'] })) events.push(event)
    expect(events).toEqual([{ kind: 'result', output: expect.objectContaining({ skillId: 'pdf', content: expect.any(String) }) }])
    await platform.disable('pdf')
    expect((await store.listSkills()).find(skill => skill.id === 'pdf')).toBeUndefined()
    await expect(store.readEnabledSkillFile('pdf')).rejects.toThrow()
    expect((await store.listSkills()).find(skill => skill.id === 'documents')?.enabled).toBe(true)
    await platform.disable('skills')
    expect(registry.list().find(tool => tool.id === 'tools/local/skills/read')).toBeUndefined()
  } finally { await platform.dispose(); await rm(home, { recursive: true, force: true }) }
}, 20000)
it('routes current dependency calls and grants through the command host and withdraws the tool on disable', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { createRuntimePluginPlatform } = await import('../src/plugins/composition')
  const { RuntimeToolRegistry } = await import('../src/tool-registry')
  const home = await mkdtemp(join(tmpdir(), 'actiondriver-command-identity-'))
  const registry = new RuntimeToolRegistry()
  const id = 'tools/local/command/dependencies/load'
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/dist/plugin-host.mjs'), packageRoots: [resolve('apps/agent-runtime/dist/plugins/command')], dataRoot: home, registry, configuration: {}, now: Date.now, ids: () => String(Math.random()),
    hostCapabilities: { 'host.command.execute': { plugins: ['command'], grants: [`${id}@1`], async *stream(input, authority) {
      expect(input).toMatchObject({ toolId: id, call: { modelName: 'tools_local_command_dependencies_load' } })
      expect(authority.grants).toEqual([`${id}@1`])
      yield { kind: 'result', output: { node: '/bundled/node' } }
    } } }
  })
  try {
    await platform.enable('command')
    expect(registry.resolve(id, 1).owner?.pluginId).toBe('command')
    expect(registry.list()).toHaveLength(5)
    const events = []
    for await (const event of registry.resolveModelName('tools_local_command_dependencies_load').executor.execute({ callId: 'current', providerCallId: 'p', modelName: 'tools_local_command_dependencies_load', arguments: {} }, new AbortController().signal, { taskId: 't', sessionId: 's', workspace: { root: home, input: home, output: home }, grants: [`${id}@1`] })) events.push(event)
    expect(events).toEqual([{ kind: 'result', output: { node: '/bundled/node' } }])
    await platform.disable('command')
    expect(() => registry.resolve(id, 1)).toThrow('TOOL_UNAVAILABLE')
    expect(() => registry.resolveModelName('tools_local_command_dependencies_load')).toThrow('TOOL_UNAVAILABLE')
  } finally { await platform.dispose(); await rm(home, { recursive: true, force: true }) }
}, 10000)
