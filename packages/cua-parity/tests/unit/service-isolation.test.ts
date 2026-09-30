// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditServiceIsolation } from '../../src/service-isolation'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'cua-service-isolation-'))
  roots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

test('finds private RPC, native pipe, App path and original bundle imports', async () => {
  const root = await fixture({
    'src/rpc.ts': `await nodeRepl.rpc('browser', {command})`,
    'src/pipe.ts': `await host.nativePipe.createConnection(host.env.CODEX_HOME + '/computer-use/pipe')`,
    'dist/path.js': `const app = '/Applications/Codex.app/Contents/Resources/cua_node'`,
    'src/load.ts': `await import('../../thirdparty/backup/codex-cua/@oai/cua/index.js')`,
    'src/metadata.ts': `const turn = nodeRepl.requestMeta.turnId`,
    'src/global.ts': `const host = globalThis.nodeRepl`,
    'src/broker.ts': `await connectAuthBroker(request.authBrokerPipePath)`
  })
  const findings = await auditServiceIsolation([root])
  expect(findings.map(({ path, reason }) => [path.slice(root.length + 1), reason])).toEqual([
    ['dist/path.js', 'codex-app-path'],
    ['src/broker.ts', 'private-auth-broker'],
    ['src/global.ts', 'private-node-repl-global'],
    ['src/load.ts', 'original-bundle-import'],
    ['src/metadata.ts', 'private-turn-metadata'],
    ['src/pipe.ts', 'private-native-pipe'],
    ['src/rpc.ts', 'private-node-repl-rpc']
  ])
})

test('rejects dynamic loading and an injected path disguised as a local socket', async () => {
  const root = await fixture({
    'src/dynamic.ts': `const path = process.env.CODEX_HOME + '/computer-use/Codex Computer Use.app'\nawait import(path)`,
    'src/disguised.ts': `await host.nativePipe.createConnection('/tmp/action-driver.sock')`,
    'src/template.ts': "const path = `${prefix}/vendor/codex-cua/original.mjs`\nawait import(path)"
  })
  expect((await auditServiceIsolation([root])).map(({ reason }) => reason)).toEqual([
    'private-native-pipe',
    'codex-home-path',
    'original-bundle-import'
  ])
})

test('allows explicit Action-Driver helper and own socket; skips read-only originals', async () => {
  const root = await fixture({
    'packages/sky/src/host.ts': `await productHelper.request({kind: 'getState'})\nawait connect('/tmp/action-driver/browser.sock')`,
    'thirdparty/backup/codex-cua/original.mjs': `await nodeRepl.rpc('browser', {})`,
    'analysis/codex-cua/readable/original.mjs': `await nodeRepl.rpc('browser', {})`,
    'thirdparty/backup/codex-cua/original.mjs': `await nodeRepl.rpc('browser', {})`
  })
  expect(await auditServiceIsolation([root])).toEqual([])
})

test('checks executable acceptance scripts while leaving archived readable sources alone', async () => {
  const root = await fixture({
    'analysis/codex-cua/verify-macos.mjs': `await nodeRepl.rpc('browser', {})`,
    'analysis/codex-cua/readable/original.mjs': `await nodeRepl.rpc('browser', {})`
  })
  expect((await auditServiceIsolation([root])).map(({ path }) => path.slice(root.length + 1))).toEqual([
    'analysis/codex-cua/verify-macos.mjs'
  ])
})
