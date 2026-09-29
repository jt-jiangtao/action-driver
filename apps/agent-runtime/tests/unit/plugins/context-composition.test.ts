import { expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRuntimePluginPlatform } from '../../../src/plugins/composition'
import { PluginContextKeys } from '../../../src/plugins/context-keys'
import { RuntimeToolRegistry } from '../../../src/tool-registry'
import { RuntimeToolPolicy } from '../../../src/tool-policy'

it('owns plugin context keys for the real host lifecycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-context-plugin-'))
  const root = join(directory, 'plugin')
  await mkdir(root)
  await writeFile(join(root, 'plugin.json'), JSON.stringify({
    id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs',
    platforms: [`${process.platform}-${process.arch}`], contributions: []
  }))
  await writeFile(join(root, 'extension.mjs'), "export async function activate(context) { await context.api.context.set('plugin.fixture.ready', true) }")
  const contextKeys = new PluginContextKeys()
  const platform = await createRuntimePluginPlatform({
    node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'),
    packageRoots: [root], dataRoot: join(directory, 'data'), registry: new RuntimeToolRegistry(),
    configuration: {}, now: Date.now, ids: () => String(Math.random()), contextKeys
  })
  try {
    await platform.enable('fixture')
    expect(contextKeys.snapshot().values['plugin.fixture.ready']).toBe(true)
    await platform.disable('fixture')
    expect(contextKeys.snapshot().values).toEqual({})
  } finally { await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)

it('filters plugin tools from discovery and rejects direct execution after context changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-context-tool-'))
  const root = join(directory, 'plugin')
  await mkdir(root)
  const definition = { id: 'tools/local/fixture/run', version: 1, modelName: 'tools_local_fixture_run', description: 'Run', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
  await writeFile(join(root, 'plugin.json'), JSON.stringify({ id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', catalog: 'catalog.json', platforms: [`${process.platform}-${process.arch}`], contributions: [{ kind: 'tool', id: definition.id, modelName: definition.modelName, when: 'plugin.fixture.ready' }] }))
  await writeFile(join(root, 'catalog.json'), JSON.stringify({ tools: [definition], skills: [] }))
  await writeFile(join(root, 'extension.mjs'), `export function activate(context) { context.api.tools.register(${JSON.stringify(definition)}, { async *execute() { yield { kind: 'result', output: 'ran' } } }) }`)
  const registry = new RuntimeToolRegistry(), keys = new PluginContextKeys()
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [root], dataRoot: join(directory, 'data'), registry, configuration: {}, now: Date.now, ids: () => String(Math.random()), contextKeys: keys })
  try {
    await platform.enable('fixture')
    const registered = registry.resolve(definition.id, 1)
    const call = { callId: 'one', providerCallId: 'p', modelName: definition.modelName, arguments: {} }
    expect(registry.list()).toEqual([])
    await expect(registered.executor.execute(call)[Symbol.asyncIterator]().next()).rejects.toThrow('UNAVAILABLE')
    const owner = platform.manager.contributions()[0]!.owner
    keys.setPlugin(owner, 'plugin.fixture.ready', true)
    expect(registry.list().map(tool => tool.id)).toEqual([definition.id])
    expect(new RuntimeToolPolicy().discover(registry.list(), { grants: [] })).toEqual([])
    const events = []
    for await (const event of registered.executor.execute({ ...call, callId: 'two' })) events.push(event)
    expect(events).toEqual([{ kind: 'result', output: 'ran' }])
    keys.setPlugin(owner, 'plugin.fixture.ready', false)
    expect(registry.list()).toEqual([])
    await expect(registered.executor.execute({ ...call, callId: 'three' })[Symbol.asyncIterator]().next()).rejects.toThrow('UNAVAILABLE')
  } finally { await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)
