import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRuntimePluginPlatform } from '../../../../apps/agent-runtime/src/plugins/composition'
import { AgentFileStore } from '../../../../apps/agent-runtime/src/agent-files/agent-file-store'
import { PluginInstructionHost } from '../../../../apps/agent-runtime/src/plugins/instruction-host'
import { RuntimeToolRegistry } from '../../../../apps/agent-runtime/src/tool-registry'
import { NodePluginHostFactory } from '../../../../apps/agent-runtime/src/plugins/process-host'
import { PluginManager } from '../../../../apps/agent-runtime/src/plugins/manager'
import { validateManifest, validateCatalog } from '@actiondriver/plugin-contracts'
const run = promisify(execFile)
import { generatePlugin } from '../../src/generate.mjs'
const temporary: string[] = []
async function directory() { const path = await mkdtemp(join(tmpdir(), 'actiondriver-generator-')); temporary.push(path); return path }
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
describe('plugin generator', () => {
  it('creates a same-package catalog, skill, execution and lifecycle with npm SDK dependency', async () => {
    const root = await directory(), target = join(root, 'plugin')
    await generatePlugin({ id: 'example-tools', directory: target })
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(target, 'plugin.json'), 'utf8'))
    expect(pkg.dependencies).toEqual({ '@actiondriver/plugin-sdk': '^1.0.0' })
    expect(pkg.exports).toEqual({ '.': './dist/extension.js', './catalog': './dist/catalog.js', './presentation': './dist/presentation.js' })
    expect(manifest.entry).toBe('dist/extension.js')
    expect(manifest.catalog).toBe('dist/catalog.js')
    expect(await readdir(join(target, 'src'))).toEqual(['catalog.ts', 'execution.ts', 'extension.ts', 'presentation.ts', 'raw-assets.d.ts'])
    expect(await readFile(join(target, 'skills/hello/SKILL.md'), 'utf8')).toContain('tools_local_example_tools_echo')
    const readme = await readFile(join(target, 'README.md'), 'utf8')
    expect(readme).toContain('plugin.example-tools.ready')
    expect(readme).toContain('context.api.context.set')
  })
  it('refuses existing files and invalid plugin IDs without changing destinations', async () => {
    const root = await directory()
    await writeFile(join(root, 'keep.txt'), 'original')
    await expect(generatePlugin({ id: 'example', directory: root })).rejects.toThrow('not empty')
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('original')
    await expect(generatePlugin({ id: '../escape', directory: join(root, 'new') })).rejects.toThrow('Invalid plugin ID')
    expect(await readdir(root)).toEqual(['keep.txt'])
  })
})


describe('packaged SDK and generated plugin', () => {
  it('builds outside the repository and loads its same-package catalog and execution in a real host', async () => {
    const root = await directory(), project = join(root, 'generated')
    for (const pkg of ['plugin-contracts', 'plugin-sdk']) {
      await run('corepack', ['pnpm', '--dir', resolve('packages', pkg), 'pack', '--pack-destination', root])
    }
    await generatePlugin({ id: 'generated', directory: project })
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(root, 'actiondriver-plugin-contracts-1.0.0.tgz'), join(root, 'actiondriver-plugin-sdk-1.0.0.tgz')], { cwd: project })
    await run('npm', ['test'], { cwd: project })
    const manifest = validateManifest(JSON.parse(await readFile(join(project, 'plugin.json'), 'utf8')), { sdk: '1.0.0', platform: 'darwin-arm64' })
    // A separate Node process imports only generated dist and installed tarballs.
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', "import { catalog } from './dist/catalog.js'; console.log(JSON.stringify(catalog))"], { cwd: project })
    const catalog = validateCatalog(JSON.parse(stdout), manifest)
    expect(catalog.tools[0]?.id).toBe('tools/local/generated/echo')
    expect(catalog.tools[0]?.presentation).toEqual({ input: [{ label: '消息', path: 'message', kind: 'text' }], output: [{ label: '回显消息', path: 'result.message', kind: 'text' }] })
    const metadata = await run(process.execPath, ['--input-type=module', '-e', "import { presentations } from 'generated/presentation'; console.log(JSON.stringify(presentations))"], { cwd: project })
    expect(JSON.parse(metadata.stdout)['tools/local/generated/echo']).toEqual(catalog.tools[0]?.presentation)
    expect(catalog.skills[0]?.resources).toEqual(['skills/hello/SKILL.md'])
    const factory = new NodePluginHostFactory({ executable: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoot: () => project, token: () => 'test-token', request: async () => { throw new Error('Unexpected host request') } })
    const manager = new PluginManager({ sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => 'test', factory, repository: { async publish() {}, async list() { return [] }, async remove() {} } })
    await manager.install(manifest); await manager.enable('generated'); await manager.activate('generated')
    try {
      expect(manager.contributions().map(value => value.contribution.id)).toEqual(['tools/local/generated/echo', 'generated.hello'])
      expect(await manager.invoke('tools/local/generated/echo', { call: { callId: 'c', providerCallId: 'p', modelName: 'tools_local_generated_echo', arguments: { message: 'hello' } } }, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)).toEqual([{ kind: 'result', output: { message: 'hello' } }])
    } finally { await manager.disable('generated') }
    expect(manager.contributions()).toEqual([])
    // Installed package intentionally has no project node_modules: built entries must be portable.
    const registry = new RuntimeToolRegistry(), skills = new PluginInstructionHost(join(root, 'home'), ['computer-use'])
    const files = new AgentFileStore({ homeDirectory: join(root, 'home'), pluginSkills: skills })
    await files.initialize()
    const platform = await createRuntimePluginPlatform({ node: process.execPath, hostEntry: resolve('apps/agent-runtime/src/plugins/host-entry.mjs'), packageRoots: [project], skills, dataRoot: join(root, 'installed'), registry, configuration: {}, now: Date.now, ids: () => 'installed' })
    try {
      await platform.enable('generated')
      expect((await files.listSkills()).find(skill => skill.id === 'generated.hello')).toMatchObject({ source: 'plugin', enabled: true })
      expect((await files.readEnabledSkillFile('generated.hello')).content).toContain('tools_local_generated_echo')
      const events = []
      for await (const event of registry.resolve('tools/local/generated/echo', 1).executor.execute({ callId: 'installed', providerCallId: 'p', modelName: 'tools_local_generated_echo', arguments: { message: 'portable' } })) events.push(event)
      expect(events).toEqual([{ kind: 'result', output: { message: 'portable' } }])
    } finally { await platform.dispose() }
    await expect(files.readEnabledSkillFile('generated.hello')).rejects.toThrow('Skill 未启用')

    const packedSDK = JSON.parse(await readFile(join(project, 'node_modules/@actiondriver/plugin-sdk/package.json'), 'utf8'))
    expect(packedSDK.dependencies).toEqual({ '@actiondriver/plugin-contracts': '1.0.0' })
    const packed = await run('npm', ['pack', '--json'], { cwd: project })
    expect(JSON.parse(packed.stdout)[0].files.map((file: { path: string }) => file.path)).toContain('skills/hello/SKILL.md')
  }, 60000)
})
