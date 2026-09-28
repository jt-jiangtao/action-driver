// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { NodeServiceSupervisor } from './service-supervisor'
const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'epoch' }
describe('supervised plugin services', () => {
  it('rejects missing platform artifacts rather than launching a system fallback', async () => {
    const supervisor = new NodeServiceSupervisor({ node: process.execPath, platform: 'darwin-arm64', log() {} })
    await expect(supervisor.start({ id: 'fixture.native', kind: 'native', artifacts: { 'linux-x64': 'bin/linux-x64/helper' } }, owner, resolve('apps/agent-runtime/src/plugins/fixtures'))).rejects.toThrow('PLATFORM_UNAVAILABLE')
  })
  it('connects stdio MCP, exposes schema and drops availability on stop without inheriting global credentials', async () => {
    const original = process.env.ACTIONDRIVER_TEST_GLOBAL_CREDENTIAL
    process.env.ACTIONDRIVER_TEST_GLOBAL_CREDENTIAL = 'should-not-be-inherited'
    const supervisor = new NodeServiceSupervisor({ node: process.execPath, platform: 'darwin-arm64', log() {} })
    const service = await supervisor.start({ id: 'fixture.mcp', kind: 'mcp-stdio', runtime: 'node', entry: 'mcp-server.mjs' }, owner, resolve('apps/agent-runtime/src/plugins/fixtures'))
    try {
      expect(service.tools()[0]).toMatchObject({ name: 'echo', inputSchema: { type: 'object' } })
      expect(await service.call('echo', { value: 'hello' }, new AbortController().signal)).toMatchObject({ content: [{ type: 'text', text: 'hello:isolated' }] })
      await service.dispose()
      expect(service.isAvailable()).toBe(false)
      await expect(service.call('echo', {}, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
    } finally {
      await service.dispose()
      if (original === undefined) delete process.env.ACTIONDRIVER_TEST_GLOBAL_CREDENTIAL; else process.env.ACTIONDRIVER_TEST_GLOBAL_CREDENTIAL = original
    }
  })
  it('refuses non-protocol stdout from an MCP process', async () => {
    const supervisor = new NodeServiceSupervisor({ node: process.execPath, platform: 'darwin-arm64', log() {} })
    await expect(supervisor.start({ id: 'fixture.bad', kind: 'mcp-stdio', runtime: 'node', entry: 'bad-mcp.mjs' }, owner, resolve('apps/agent-runtime/src/plugins/fixtures'))).rejects.toThrow('PROTOCOL_ERROR')
  })
})
it('connects HTTP MCP through explicit credential headers and closes its session', async () => {
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [resolve('apps/agent-runtime/src/plugins/fixtures/mcp-http-server.mjs')], { env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  const port = await new Promise<number>((resolve, reject) => { child.once('message', (value: unknown) => resolve((value as { port: number }).port)); child.once('error', reject); child.once('exit', () => reject(new Error('Fixture exited'))) })
  const supervisor = new NodeServiceSupervisor({ node: process.execPath, platform: 'darwin-arm64', log() {}, credentials: async () => ({ 'X-Plugin-Test': 'fixture' }) })
  const service = await supervisor.start({ id: 'fixture.http', kind: 'mcp-http', url: `http://127.0.0.1:${port}` }, owner, resolve('apps/agent-runtime/src/plugins/fixtures'))
  try {
    expect(service.tools()[0]?.name).toBe('echo')
    expect(await service.call('echo', { value: 'hello-http' }, new AbortController().signal)).toMatchObject({ content: [{ type: 'text', text: 'hello-http' }] })
  } finally { await service.dispose(); child.disconnect(); child.kill() }
})

it('restarts a failed Node service only up to its declared limit', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'actiondriver-restart-'))
  await writeFile(join(root, 'service.mjs'), "process.stdout.write('started\\n'); process.exitCode = 1")
  let launches = 0
  let exited!: () => void
  const done = new Promise<void>(resolve => { exited = resolve })
  const supervisor = new NodeServiceSupervisor({ node: process.execPath, platform: `${process.platform}-${process.arch}`, log(_owner, stream, text) { if (stream === 'stdout' && text.includes('started')) launches++ } })
  const service = await supervisor.start({ id: 'fixture.node', kind: 'node', entry: 'service.mjs', restart: { attempts: 2, backoffMs: 10 } }, owner, root)
  service.onExit(exited)
  try {
    await done
    expect(launches).toBe(3)
    expect(service.isAvailable()).toBe(false)
    await expect(service.call('unsupported', {}, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }) }
})
