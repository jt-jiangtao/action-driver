import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export async function generatePlugin({ id, directory, sdkVersion = '^1.0.0' }) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)) throw new Error('Invalid plugin ID')
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Destination is required')
  const target = resolve(directory)
  try {
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(target)).length) throw new Error('Destination is not empty')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, `.${basename(target)}-`))
  const modelName = `${id.replace(/[.-]/g, '_')}_echo`
  const skill = `---\nname: ${id}-hello\ndescription: Use the ${id} echo tool when the user wants a message echoed.\n---\n\nCall ${id}.echo with a message. This instruction does not grant tool authorization.\n`
  const files = {
    'package.json': JSON.stringify({ name: id, version: '0.1.0', type: 'module', exports: { '.': './dist/extension.js', './catalog': './dist/catalog.js' }, files: ['dist', 'plugin.json', 'skills'], scripts: { build: 'tsc -p tsconfig.json && esbuild src/extension.ts src/catalog.ts --outdir=dist --bundle --platform=node --format=esm', test: 'npm run build && node --test tests/lifecycle.test.mjs', prepack: 'npm run build' }, dependencies: { '@actiondriver/plugin-sdk': sdkVersion }, devDependencies: { typescript: '5.9.3', esbuild: '0.28.2' } }, null, 2) + '\n',
    'plugin.json': JSON.stringify({ id, version: '0.1.0', sdk: '^1.0.0', entry: 'dist/extension.js', catalog: 'dist/catalog.js', platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'], activation: [`onTool:${id}.echo`], contributions: [{ kind: 'tool', id: `${id}.echo`, modelName }, { kind: 'skill', id: `${id}.hello` }], dependencies: [] }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, declaration: true, outDir: 'dist', rootDir: 'src', lib: ['ES2022', 'DOM'], skipLibCheck: true }, include: ['src'] }, null, 2) + '\n',
    'src/catalog.ts': `import type { PluginCatalog, ToolDefinition } from '@actiondriver/plugin-sdk'\n\nexport const echoDefinition: ToolDefinition = {\n  id: '${id}.echo', version: 1, modelName: '${modelName}', description: 'Echo a message',\n  inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },\n  risk: 'low', sideEffects: { filesystem: 'none', network: false }, timeoutMs: 1000\n}\n\nexport const catalog: PluginCatalog = {\n  tools: [echoDefinition],\n  skills: [{ id: '${id}.hello', name: '${id}-hello', description: 'Echo a message', content: ${JSON.stringify(skill)}, resources: ['skills/hello/SKILL.md'] }]\n}\n`,
    'src/execution.ts': `import { PluginError, type ToolExecutor } from '@actiondriver/plugin-sdk'\n\nexport function createEchoExecutor(): ToolExecutor {\n  return { async *execute(call, signal) {\n    if (signal?.aborted) throw new PluginError('CANCELLED', 'Echo cancelled')\n    yield { kind: 'result', output: { message: String(call.arguments.message ?? '') } }\n  } }\n}\n`,
    'src/extension.ts': `import type { PluginContext, StopReason } from '@actiondriver/plugin-sdk'\nimport { catalog, echoDefinition } from './catalog.js'\nimport { createEchoExecutor } from './execution.js'\n\nexport function activate(context: PluginContext): void {\n  context.api.tools.register(echoDefinition, createEchoExecutor())\n  context.api.contributions.register({ kind: 'skill', id: catalog.skills[0]!.id })\n}\n\nexport function deactivate(_reason: StopReason): void {\n  // The host owns and disposes registrations and resources, even if this hook fails.\n}\n`,
    'skills/hello/SKILL.md': skill,
    'tests/lifecycle.test.mjs': `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { createPluginContext } from '@actiondriver/plugin-sdk'\nimport { activate, deactivate } from '../dist/extension.js'\nimport { catalog } from '../dist/catalog.js'\n\ntest('activation and host cleanup own every contribution', async () => {\n  const live = new Set()\n  const own = id => { live.add(id); return { dispose() { live.delete(id) } } }\n  const context = createPluginContext({ pluginId: '${id}', version: '0.1.0', hostEpoch: 'test' }, {\n    tools: { register(definition) { return own(definition.id) } },\n    registrations: { register(contribution) { return own(contribution.id) } },\n    transport: { async request() { throw new Error('No host transport configured in this test') } }\n  })\n  assert.equal(live.size, 0)\n  assert.equal(catalog.tools[0].inputSchema.type, 'object')\n  activate(context)\n  assert.equal(live.size, 2)\n  deactivate('disabled')\n  await context.subscriptions.dispose()\n  assert.equal(live.size, 0)\n})\n`,
    '.gitignore': 'node_modules/\ndist/\n*.tgz\n',
    'README.md': `# ${id}\n\nInstall dependencies with npm install, build with npm run build, and run npm test. Package with npm pack.\n\nSkill instructions, the pure catalog and execution entry ship in this one plugin package. Import ${id}/catalog to compose tool schemas and Skill instructions without activation. The ActionDriver host manages activation, authorization, cancellation and cleanup. SDK 1.x is required.\n\nPlugins run as trusted user code; process isolation is not an OS sandbox.\n`
  }
  try {
    for (const [path, content] of Object.entries(files)) {
      const destination = join(staging, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content, { flag: 'wx' })
    }
    await rename(staging, target)
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}
