import { describe, expect, it } from 'vitest'
import type { ServiceHttpOptions } from '../../../src/service/http-service'
import { createRuntimePluginPlatform } from '../../../src/plugins/composition'
import { RuntimeToolRegistry } from '../../../src/tool-registry'
import { createWebCredentialPort } from '../../../src/plugins/web-credentials'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
describe('runtime plugin composition', () => {
  it('loads search catalog externally and routes its existing result through an owned plugin registration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'actiondriver-search-plugin-'))
    const root = join(directory, 'web')
    await mkdir(join(root, 'dist'), { recursive: true })
    await cp(resolve('plugins/web/plugin.json'), join(root, 'plugin.json'))
    await cp(resolve('plugins/web/package.json'), join(root, 'package.json'))
    await promisify(execFile)('corepack', ['pnpm', '--filter', '@actiondriver/agent-runtime', 'exec', 'esbuild', resolve('plugins/web/src/catalog.ts'), resolve('plugins/web/src/extension.ts'), '--outdir=' + join(root, 'dist'), '--bundle', '--platform=node', '--format=esm'])
    const extension = join(root, 'dist', 'extension.js')
    await writeFile(extension, `globalThis.fetch = async (url, init) => { if (url !== 'https://api.tavily.com/search' || new Headers(init.headers).get('authorization') !== 'Bearer fixture-key') throw new Error('Unexpected provider request'); return new Response(JSON.stringify({ results: [{ title: 'Title', url: 'https://example.test/', content: 'Snippet' }] }), { headers: { 'content-type': 'application/json' } }) };\n` + await readFile(extension, 'utf8'))
    const web = createWebCredentialPort({ TAVILY_API_KEY: 'fixture-key' })
    const registry = new RuntimeToolRegistry(), grants: string[] = []
    let platform: Awaited<ReturnType<typeof createRuntimePluginPlatform>> | undefined
    try {
      platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [root], registry, configuration: { web: web.configuration }, apiPorts: { credentials: web.credentials }, dataRoot: join(directory, 'data'), now: () => Date.now(), ids: () => 'instance' })
      expect(platform.catalogs()[0]?.catalog.tools[0]?.inputSchema.required).toEqual(['query'])
      expect(grants).toEqual([])
      await platform.enable('web')
      expect(registry.resolve('tools/local/web/search', 1).owner?.pluginId).toBe('web')
      const events = []
      for await (const part of registry.resolve('tools/local/web/search', 1).executor.execute({ callId: 'c', providerCallId: 'p', modelName: 'tools_local_web_search', arguments: { query: 'test' } }, new AbortController().signal, { taskId: 'task', sessionId: 'session', workspace: { root: directory, input: directory, output: directory }, grants: ['tools/local/web/search@1'] })) events.push(part)
      expect(events).toEqual([{ kind: 'result', output: { results: [{ title: 'Title', url: 'https://example.test/', snippet: 'Snippet' }], truncated: false, totalResults: 1 } }])
      await platform.disable('web')
      expect(registry.list()).toEqual([])
    } finally {
      await platform?.dispose(); await rm(directory, { recursive: true, force: true })
    }
  })
})
it('streams a declared host capability with runtime grants and authoritative task context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-forward-plugin-'))
  const packageRoot = join(directory, 'package')
  await mkdir(packageRoot)
  const definition = { id: 'fixture/echo', version: 1, modelName: 'fixture_echo', description: 'Echo', inputSchema: { type: 'object', properties: {} }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(packageRoot, 'catalog.json'), JSON.stringify({ tools: [definition], skills: [] }))
  await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify({ id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', catalog: 'catalog.json', platforms: [`${process.platform}-${process.arch}`], requires: ['host.echo'], contributions: [{ kind: 'tool', id: 'fixture/echo', modelName: 'fixture_echo' }] }))
  await writeFile(join(packageRoot, 'extension.mjs'), `export function activate(context) { context.api.tools.register(${JSON.stringify(definition)}, { async *execute(call, signal, _execution, invocation) { yield* context.api.capabilities.stream('host.echo', call.arguments, invocation, signal) } }) }`)
  const registry = new RuntimeToolRegistry()
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [packageRoot], registry, configuration: {}, dataRoot: join(directory, 'data'), now: Date.now, ids: () => String(Math.random()), hostCapabilities: { 'host.echo': { plugins: ['fixture'], grants: ['fixture/echo@1'], async *stream(_input, context) { yield { kind: 'content', stream: 'stdout', delta: context.taskId! }; await gate; yield { kind: 'result', output: 'done' } } } } })
  try {
    await platform.enable('fixture')
    const executor = registry.resolve('fixture/echo', 1).executor
    const call = { callId: 'c', providerCallId: 'p', modelName: 'fixture_echo', arguments: { taskId: 'forged', grants: ['*'] } }
    await expect(executor.execute(call)[Symbol.asyncIterator]().next()).rejects.toThrow('AUTHORIZATION_DENIED')
    const output = executor.execute({ ...call, callId: 'allowed' }, new AbortController().signal, { taskId: 'persisted', sessionId: 's', grants: ['fixture/echo@1'], workspace: { root: directory, input: directory, output: directory } })[Symbol.asyncIterator]()
    expect(await output.next()).toEqual({ value: { kind: 'content', stream: 'stdout', delta: 'persisted' }, done: false })
    finish()
    expect(await output.next()).toEqual({ value: { kind: 'result', output: 'done' }, done: false })
    expect((await output.next()).done).toBe(true)
  } finally { finish(); await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)
it('installs, pins an in-flight version, upgrades its real package and uninstalls registrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-upgrade-plugin-'))
  const { writeFile } = await import('node:fs/promises')
  const definition = { id: 'fixture/version', version: 1, modelName: 'fixture_version', description: 'Version', inputSchema: { type: 'object', properties: {} }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
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
    const { PluginPrivateStorage } = await import('../../../src/plugins/filesystem-repository')
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
    const { createServiceHttpApp } = await import('../../../src/service/http-service')
    const app = createServiceHttpApp({ service: {} as ServiceHttpOptions['service'], token: 'token', runtimeVersion: 'test', pluginInterface: { message: platform.panelMessage, contributions: platform.uiContributions, openView: platform.openView, executeCommand: platform.executeCommand } })
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
    const webRoot = join(directory, 'web')
    await mkdir(join(webRoot, 'dist'), { recursive: true })
    await cp(resolve('plugins/web/plugin.json'), join(webRoot, 'plugin.json'))
    await cp(resolve('plugins/web/package.json'), join(webRoot, 'package.json'))
    await promisify(execFile)('corepack', ['pnpm', '--filter', '@actiondriver/agent-runtime', 'exec', 'esbuild', resolve('plugins/web/src/catalog.ts'), resolve('plugins/web/src/extension.ts'), '--outdir=' + join(webRoot, 'dist'), '--bundle', '--platform=node', '--format=esm'])
    for (const id of ['search', 'web-reader']) {
      const root = join(directory, 'installed', id)
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'current.json'), JSON.stringify({ id, version: '1.0.0', entry: 'missing.mjs', catalog: 'missing.mjs', sdk: '^1.0.0', platforms: [`${process.platform}-${process.arch}`], contributions: [] }))
      const data = join(directory, 'data', id); await mkdir(data, { recursive: true }); await writeFile(join(data, 'saved.json'), '{"preserved":true}')
    }
    const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [webRoot], retiredPluginIds: ['search', 'web-reader'], registry: new RuntimeToolRegistry(), configuration: {}, dataRoot: directory, now: Date.now, ids: () => String(Math.random()) })
    try {
      expect(platform.catalogs().map(value => value.manifest.id)).toEqual(['web'])
      await platform.enable('web')
      expect(platform.manager.contributions().map(value => value.contribution.id)).toEqual([])
      for (const id of ['search', 'web-reader']) expect(await readFile(join(directory, 'data', id, 'saved.json'), 'utf8')).toBe('{"preserved":true}')
    } finally { await platform.dispose() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('replaces a cached web 1.2.0 package with the Tavily/Jina release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-web-upgrade-'))
  const packageRoot = join(directory, 'package')
  const dataRoot = join(directory, 'data')
  const cached = join(dataRoot, 'installed/web/1.2.0')
  let platform: Awaited<ReturnType<typeof createRuntimePluginPlatform>> | undefined
  try {
    await cp(resolve('apps/agent-runtime/dist/plugins/web'), packageRoot, { recursive: true })
    const manifest = JSON.parse(await readFile(join(packageRoot, 'plugin.json'), 'utf8')) as { version: string }
    expect(manifest.version).toBe('1.3.0')
    await mkdir(join(cached, 'dist'), { recursive: true })
    await writeFile(join(cached, 'dist/extension.js'), "export function activate() { throw new Error('STALE_WEB_PACKAGE') }")
    await writeFile(join(cached, 'package.json'), '{"type":"module"}')
    await writeFile(join(dataRoot, 'installed/web/current.json'), JSON.stringify({ ...manifest, version: '1.2.0' }))
    const registry = new RuntimeToolRegistry()
    const credentials = createWebCredentialPort({ TAVILY_API_KEY: 'fixture-search-key', JINA_API_KEY: 'fixture-reader-key' })
    platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [packageRoot], dataRoot, registry, configuration: { web: credentials.configuration }, apiPorts: { credentials: credentials.credentials }, now: Date.now, ids: () => String(Math.random()) })
    await platform.enable('web')
    expect(registry.resolve('tools/local/web/search', 1).owner?.version).toBe('1.3.0')
    expect(registry.resolve('tools/local/web/open', 1).owner?.version).toBe('1.3.0')
    expect(await readFile(join(cached, 'dist/extension.js'), 'utf8')).toContain('STALE_WEB_PACKAGE')
  } finally { await platform?.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10000)
it('rejects a persisted third-party plugin with a dotted tool identity before activation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-old-tool-plugin-'))
  const { writeFile } = await import('node:fs/promises')
  const root = join(directory, 'installed', 'fixture', '1.0.0')
  await mkdir(root, { recursive: true })
  const manifest = { id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', platforms: [`${process.platform}-${process.arch}`], contributions: [{ kind: 'tool', id: 'fixture.read', modelName: 'fixture_read' }] }
  try {
    await writeFile(join(directory, 'installed', 'fixture', 'current.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'plugin.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'extension.mjs'), 'export function activate() {}')
    await expect(createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [], registry: new RuntimeToolRegistry(), configuration: {}, dataRoot: directory, now: Date.now, ids: () => String(Math.random()) })).rejects.toMatchObject({ code: 'INVALID_MANIFEST' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('replaces a same-version built-in copy with slash identities and preserves private data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-builtin-cutover-'))
  const { writeFile, readFile } = await import('node:fs/promises')
  const source = join(directory, 'source')
  const installed = join(directory, 'installed', 'fixture', '1.0.0')
  const definition = { id: 'fixture/read', version: 1, modelName: 'fixture_read', description: 'Read fixture', inputSchema: { type: 'object', properties: {} }, risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000 }
  const manifest = { id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', catalog: 'catalog.json', platforms: [`${process.platform}-${process.arch}`], contributions: [{ kind: 'tool', id: definition.id, modelName: definition.modelName }] }
  const oldManifest = { ...manifest, contributions: [{ kind: 'tool', id: 'fixture.read', modelName: 'fixture_read' }] }
  await mkdir(source, { recursive: true })
  await mkdir(installed, { recursive: true })
  await writeFile(join(source, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'catalog.json'), JSON.stringify({ tools: [definition], skills: [] }))
  await writeFile(join(source, 'extension.mjs'), `export function activate(context) { context.api.tools.register(${JSON.stringify(definition)}, { async *execute() { yield { kind: 'result', output: 'current' } } }) }`)
  await writeFile(join(directory, 'installed', 'fixture', 'current.json'), JSON.stringify(oldManifest))
  await writeFile(join(installed, 'plugin.json'), JSON.stringify(oldManifest))
  await writeFile(join(installed, 'extension.mjs'), 'export function activate() {}')
  const { PluginPrivateStorage } = await import('../../../src/plugins/filesystem-repository')
  const storage = new PluginPrivateStorage(directory, () => String(Math.random()))
  await storage.set('fixture', 'settings', { saved: true })
  const registry = new RuntimeToolRegistry()
  let platform: Awaited<ReturnType<typeof createRuntimePluginPlatform>> | undefined
  try {
    platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [source], registry, configuration: {}, dataRoot: directory, now: Date.now, ids: () => String(Math.random()) })
    expect(JSON.parse(await readFile(join(installed, 'plugin.json'), 'utf8'))).toMatchObject({ contributions: manifest.contributions })
    expect(await storage.get('fixture', 'settings')).toEqual({ saved: true })
    await platform.enable('fixture')
    expect(registry.resolve('fixture/read', 1).definition.modelName).toBe('fixture_read')
    expect(() => registry.resolve('fixture.read', 1)).toThrow('TOOL_UNAVAILABLE')
  } finally { await platform?.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10_000)

it('discovers declared views and menus without activation, activates on demand and re-checks conditions and grants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-ui-plugin-'))
  const { writeFile } = await import('node:fs/promises')
  const packageRoot = join(directory, 'package')
  await mkdir(packageRoot)
  const manifest = {
    id: 'ui', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', catalog: 'catalog.json',
    platforms: [`${process.platform}-${process.arch}`],
    contributions: [
      { kind: 'command', id: 'ui.refresh', when: 'plugin.ui.ready' },
      { kind: 'view', id: 'ui.dashboard', when: 'plugin.ui.ready' },
      { kind: 'menu', id: 'ui.refresh-menu' }
    ],
    views: [{ id: 'ui.dashboard', title: 'Dashboard', container: 'sidebar', entry: 'view.html' }],
    menus: [{ id: 'ui.refresh-menu', title: '刷新', command: 'ui.refresh', location: 'plugins-menu' }]
  }
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(join(packageRoot, 'catalog.json'), JSON.stringify({ tools: [], skills: [] }))
  await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(join(packageRoot, 'extension.mjs'), `export async function activate(context) {
  context.api.commands.register('ui.refresh', async input => ({ refreshed: input.count }))
  context.api.views.register('ui.dashboard', async input => ({ ok: true, input }))
  context.api.menus.register('ui.refresh-menu')
  await context.api.context.set('plugin.ui.ready', true)
}\n`)
  const surfaces: string[] = []
  const platform = await createRuntimePluginPlatform({
    node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'),
    packageRoots: [packageRoot], registry: new RuntimeToolRegistry(), configuration: {}, dataRoot: join(directory, 'data'),
    now: Date.now, ids: () => 'instance',
    desktopResources: {
      async begin(owner) { surfaces.push(`begin:${owner.pluginId}`) },
      async request(owner, method, input) { surfaces.push(`${method}:${(input as { id: string }).id}`); return { resourceId: 'surface-1' } },
      async end(owner) { surfaces.push(`end:${owner.pluginId}`) }
    },
    commandAuthority: async request => ({ grants: request.taskId === 'granted' ? ['ui/refresh@1'] : [], taskId: request.taskId ?? 'task', sessionId: 'session' })
  })
  try {
    // Catalog and UI projection are readable while the plugin is still dormant.
    expect(platform.catalogs()[0]?.catalog.views?.map(view => view.id)).toEqual(['ui.dashboard'])
    const dormant = platform.uiContributions()
    expect(dormant.views).toEqual([{ pluginId: 'ui', version: '1.0.0', definition: platform.catalogs()[0]!.catalog.views[0], available: false }])
    expect(dormant.menus[0]).toMatchObject({ pluginId: 'ui', definition: { command: 'ui.refresh' }, available: false })
    await expect(platform.executeCommand('ui', 'ui.refresh', { count: 1 }, { taskId: 'granted' })).rejects.toThrow('UNAVAILABLE')

    // Opening a view activates its owner on demand and hands the surface to the desktop host.
    expect(await platform.openView('ui', 'ui.dashboard')).toEqual({ resourceId: 'surface-1' })
    expect(surfaces).toEqual(['begin:ui', 'views.open:ui.dashboard'])
    expect(platform.manager.status('ui')).toBe('ready')
    expect(platform.uiContributions().views[0]?.available).toBe(true)
    expect(platform.uiContributions().menus[0]?.available).toBe(true)
    expect(await platform.executeCommand('ui', 'ui.refresh', { count: 2 }, { taskId: 'granted' })).toEqual({ refreshed: 2 })

    // The same authoritative condition drives the projection and the direct call.
    const owner = platform.manager.contributions().find(value => value.contribution.kind === 'view')!.owner
    platform.contextKeys.setPlugin(owner, 'plugin.ui.ready', false)
    expect(platform.uiContributions().views[0]?.available).toBe(false)
    await expect(platform.executeCommand('ui', 'ui.refresh', { count: 3 }, { taskId: 'granted' })).rejects.toThrow('UNAVAILABLE')
    platform.contextKeys.setPlugin(owner, 'plugin.ui.ready', true)

    await expect(platform.openView('ui', 'ui.unknown')).rejects.toThrow('INVALID_MANIFEST')
    await expect(platform.openView('other', 'ui.dashboard')).rejects.toThrow('INVALID_MANIFEST')
    await expect(platform.executeCommand('other', 'ui.refresh', { count: 1 }, { taskId: 'granted' })).rejects.toThrow('INVALID_MANIFEST')
    await platform.disable('ui')
    expect(platform.uiContributions()).toEqual({ views: [], menus: [] })
  } finally { await platform.dispose(); await rm(directory, { recursive: true, force: true }) }
}, 10_000)
