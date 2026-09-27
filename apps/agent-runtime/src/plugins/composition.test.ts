import { describe, expect, it } from 'vitest'
import type { ServiceHttpOptions } from '../service/http-service'
import { createRuntimePluginPlatform } from './composition'
import { RuntimeToolRegistry } from '../tool-registry'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
describe('runtime plugin composition', () => {
  it('loads search catalog externally and routes its existing result through an owned plugin registration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'actiondriver-search-plugin-'))
    const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results: [{ title: 'Title', url: 'https://example.test/', content: 'Snippet' }] })) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const root = join(directory, 'web')
    await mkdir(join(root, 'dist'), { recursive: true })
    await cp(resolve('plugins/web/plugin.json'), join(root, 'plugin.json'))
    await cp(resolve('plugins/web/package.json'), join(root, 'package.json'))
    await promisify(execFile)('corepack', ['pnpm', '--filter', '@actiondriver/agent-runtime', 'exec', 'esbuild', resolve('plugins/web/src/catalog.ts'), resolve('plugins/web/src/extension.ts'), '--outdir=' + join(root, 'dist'), '--bundle', '--platform=node', '--format=esm'])
    const registry = new RuntimeToolRegistry(), grants: string[] = []
    let platform: Awaited<ReturnType<typeof createRuntimePluginPlatform>> | undefined
    try {
      platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [root], registry, configuration: { web: { endpoint: `http://127.0.0.1:${address.port}` } }, dataRoot: join(directory, 'data'), now: () => Date.now(), ids: () => 'instance' })
      expect(platform.catalogs()[0]?.catalog.tools[0]?.inputSchema.required).toEqual(['query'])
      expect(grants).toEqual([])
      await platform.enable('web')
      expect(registry.resolve('tools.local.web.search', 1).owner?.pluginId).toBe('web')
      const events = []
      for await (const part of registry.resolve('tools.local.web.search', 1).executor.execute({ callId: 'c', providerCallId: 'p', modelName: 'tools_local_web_search', arguments: { query: 'test' } })) events.push(part)
      expect(events).toEqual([{ kind: 'result', output: { results: [{ title: 'Title', url: 'https://example.test/', snippet: 'Snippet' }], truncated: false, totalResults: 1 } }])
      await platform.disable('web')
      expect(registry.list()).toEqual([])
    } finally {
      await platform?.dispose(); server.close(); await rm(directory, { recursive: true, force: true })
    }
  })
})
it('streams a declared host capability with runtime grants and authoritative task context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-forward-plugin-'))
  const packageRoot = join(directory, 'package')
  await mkdir(packageRoot)
  const definition = { id: 'fixture.echo', version: 1, modelName: 'fixture_echo', description: 'Echo', inputSchema: { type: 'object', properties: {} }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(packageRoot, 'catalog.json'), JSON.stringify({ tools: [definition], skills: [] }))
  await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify({ id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', catalog: 'catalog.json', platforms: [`${process.platform}-${process.arch}`], requires: ['host.echo'], contributions: [{ kind: 'tool', id: 'fixture.echo', modelName: 'fixture_echo' }] }))
  await writeFile(join(packageRoot, 'extension.mjs'), `export function activate(context) { context.api.tools.register(${JSON.stringify(definition)}, { async *execute(call, signal, _execution, invocation) { yield* context.api.capabilities.stream('host.echo', call.arguments, invocation, signal) } }) }`)
  const registry = new RuntimeToolRegistry()
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [packageRoot], registry, configuration: {}, dataRoot: join(directory, 'data'), now: Date.now, ids: () => String(Math.random()), hostCapabilities: { 'host.echo': { plugins: ['fixture'], grants: ['fixture.echo@1'], async *stream(_input, context) { yield { kind: 'content', stream: 'stdout', delta: context.taskId! }; await gate; yield { kind: 'result', output: 'done' } } } } })
  try {
    await platform.enable('fixture')
    const executor = registry.resolve('fixture.echo', 1).executor
    const call = { callId: 'c', providerCallId: 'p', modelName: 'fixture_echo', arguments: { taskId: 'forged', grants: ['*'] } }
    await expect(executor.execute(call)[Symbol.asyncIterator]().next()).rejects.toThrow('AUTHORIZATION_DENIED')
    const output = executor.execute({ ...call, callId: 'allowed' }, new AbortController().signal, { taskId: 'persisted', sessionId: 's', grants: ['fixture.echo@1'], workspace: { root: directory, input: directory, output: directory } })[Symbol.asyncIterator]()
    expect(await output.next()).toEqual({ value: { kind: 'content', stream: 'stdout', delta: 'persisted' }, done: false })
    finish()
    expect(await output.next()).toEqual({ value: { kind: 'result', output: 'done' }, done: false })
    expect((await output.next()).done).toBe(true)
  } finally { finish(); await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)
it('installs, pins an in-flight version, upgrades its real package and uninstalls registrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-upgrade-plugin-'))
  const { writeFile } = await import('node:fs/promises')
  const definition = { id: 'fixture.version', version: 1, modelName: 'fixture_version', description: 'Version', inputSchema: { type: 'object', properties: {} }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
  async function packageVersion(version: string) {
    const root = join(directory, version); await mkdir(root)
    await writeFile(join(root, 'catalog.json'), JSON.stringify({ tools: [definition], skills: [] }))
    await writeFile(join(root, 'plugin.json'), JSON.stringify({ id: 'fixture', version, sdk: '^1.0.0', entry: 'extension.mjs', catalog: 'catalog.json', platforms: [`${process.platform}-${process.arch}`], contributions: [{ kind: 'tool', id: definition.id, modelName: definition.modelName }] }))
    await writeFile(join(root, 'extension.mjs'), `let saved; export function activate(context) { saved = context; context.api.tools.register(${JSON.stringify(definition)}, { async *execute() { yield { kind: 'content', stream: 'stdout', delta: 'started' }; await new Promise(resolve => setTimeout(resolve, 100)); yield { kind: 'result', output: '${version}' } } }) } export async function deactivate() { await saved.api.storage.set('stopped', '${version}') }`)
    return root
  }
  const first = await packageVersion('1.0.0'), next = await packageVersion('2.0.0'), registry = new RuntimeToolRegistry()
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [], registry, configuration: {}, dataRoot: join(directory, 'installed'), now: Date.now, ids: () => String(Math.random()) })
  try {
    await platform.install(first); await platform.enable('fixture')
    const call = { callId: 'old', providerCallId: 'p', modelName: definition.modelName, arguments: {} }
    const old = registry.resolve(definition.id, 1).executor.execute(call)[Symbol.asyncIterator]()
    expect((await old.next()).value).toMatchObject({ kind: 'content', delta: 'started' })
    await platform.upgrade(next)
    expect((await old.next()).value).toEqual({ kind: 'result', output: '1.0.0' })
    expect(registry.resolve(definition.id, 1).owner?.version).toBe('2.0.0')
    const events = []
    for await (const event of registry.resolve(definition.id, 1).executor.execute({ ...call, callId: 'next' })) events.push(event)
    expect(events.at(-1)).toEqual({ kind: 'result', output: '2.0.0' })
    await platform.disable('fixture')
    const { PluginPrivateStorage } = await import('./filesystem-repository')
    expect(await new PluginPrivateStorage(join(directory, 'installed'), () => 'marker').get('fixture', 'stopped')).toBe('2.0.0')
    const restored = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [], registry: new RuntimeToolRegistry(), configuration: {}, dataRoot: join(directory, 'installed'), now: Date.now, ids: () => String(Math.random()) })
    try { expect(restored.catalogs()[0]?.manifest.version).toBe('2.0.0'); await restored.enable('fixture') } finally { await restored.dispose() }
    await platform.uninstall('fixture', { deleteData: false })
    expect(registry.list()).toEqual([])
  } finally { await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)
it('routes an authenticated declared panel message to a live plugin without granting input control', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-panel-plugin-'))
  const root = join(directory, 'package'); await mkdir(root)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(root, 'plugin.json'), JSON.stringify({ id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', platforms: [`${process.platform}-${process.arch}`], contributions: [{ kind: 'panel', id: 'fixture.view' }], panels: [{ id: 'fixture.view', url: 'https://example.test/', messages: { inspect: { type: 'object', properties: {}, additionalProperties: false } } }] }))
  await writeFile(join(root, 'extension.mjs'), "export function activate(context) { context.api.panels.register('fixture.view', async (input, invocation) => ({ type: input.type, grants: invocation.grants, task: invocation.taskId ?? null })) }")
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [root], dataRoot: join(directory, 'data'), registry: new RuntimeToolRegistry(), configuration: {}, now: Date.now, ids: () => String(Math.random()), desktopResources: { async begin() {}, async end() {}, async request() { throw new Error('Unexpected resource request') } } })
  try {
    await platform.enable('fixture')
    const owner = platform.manager.contributions()[0]!.owner
    const { createServiceHttpApp } = await import('../service/http-service')
    const app = createServiceHttpApp({ service: {} as ServiceHttpOptions['service'], token: 'token', runtimeVersion: 'test', pluginPanels: { message: platform.panelMessage } })
    const body = JSON.stringify({ owner, panelId: 'fixture.view', type: 'inspect', payload: {} })
    const denied = await app.request('/plugins/panels/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    expect(denied.status).toBe(401)
    const response = await app.request('/plugins/panels/messages', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body })
    expect(await response.json()).toEqual({ ok: true, value: { type: 'inspect', grants: [], task: null } })
    await expect(platform.panelMessage(owner, 'fixture.view', 'control', {})).rejects.toThrow('PROTOCOL_ERROR')
  } finally { await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)

it('ignores retired built-in packages on restart and preserves their private data', async () => {
  const { writeFile, readFile } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-retired-plugins-'))
  try {
    for (const id of ['search', 'web-reader']) {
      const root = join(directory, 'installed', id)
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'current.json'), JSON.stringify({ id, version: '1.0.0', entry: 'missing.mjs', catalog: 'missing.mjs', sdk: '^1.0.0', platforms: [`${process.platform}-${process.arch}`], contributions: [] }))
      const data = join(directory, 'data', id); await mkdir(data, { recursive: true }); await writeFile(join(data, 'saved.json'), '{"preserved":true}')
    }
    const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [resolve('apps/agent-runtime/dist/plugins/web')], retiredPluginIds: ['search', 'web-reader'], registry: new RuntimeToolRegistry(), configuration: {}, dataRoot: directory, now: Date.now, ids: () => String(Math.random()) })
    try {
      expect(platform.catalogs().map(value => value.manifest.id)).toEqual(['web'])
      await platform.enable('web')
      expect(platform.manager.contributions().map(value => value.contribution.id)).toEqual(['tools.local.web.open'])
      for (const id of ['search', 'web-reader']) expect(await readFile(join(directory, 'data', id, 'saved.json'), 'utf8')).toBe('{"preserved":true}')
    } finally { await platform.dispose() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
