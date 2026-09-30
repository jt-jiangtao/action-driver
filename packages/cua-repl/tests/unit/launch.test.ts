// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createLaunchPlan, launch } from '../../src/launch'
import type { LaunchHost } from '../../src/launch'
const instructions = {
  description: 'description',
  browser: 'browser',
  computer: 'computer',
  output: 'output',
  browserDisabled: 'browser disabled',
  computerDisabled: 'computer disabled',
  server: 'server',
  code: 'code',
  reset: 'reset'
}
const base = {
  CUA_REPL_NODE_REPL_PATH: '/node-repl',
  CUA_REPL_ENABLED_SURFACES: ' computer, browser,computer, ',
  NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: '/action-driver/browser-service.mjs',
    sky: '/action-driver/computer-service.mjs' })
}
test('launch plan normalizes surfaces and composes descriptions, services and allowlist', () => {
  const result = createLaunchPlan(
    { ...base, NODE_REPL_UNTRUSTED_ENV_ALLOWLIST: 'CUSTOM' },
    instructions,
    () => 'banner'
  )
  expect(result.executable).toBe('/node-repl')
  expect(result.env.CUA_REPL_ENABLED_SURFACES).toBe('computer,browser')
  expect(result.env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST).toBe(
    'CUSTOM,CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV'
  )
  expect(JSON.parse(result.env.NODE_REPL_TRUSTED_SERVICES!)).toEqual({
    browser: '/action-driver/browser-service.mjs',
    sky: '/action-driver/computer-service.mjs'
  })
  expect(JSON.parse(result.env.NODE_REPL_TOOL_OVERRIDES!).tools.js.description).toBe(
    'description\n\nbrowser\n\ncomputer\n\noutput'
  )
})
test.each(['browser', 'computer'])(
  'disabled surfaces use disabled instructions for %s only',
  (surface) => {
    const result = createLaunchPlan(
      { ...base, CUA_REPL_ENABLED_SURFACES: surface },
      instructions,
      () => 'banner'
    )
    const overrides = JSON.parse(result.env.NODE_REPL_TOOL_OVERRIDES!)
    expect(overrides.tools.js.description).toContain(
      surface === 'browser' ? 'computer disabled' : 'browser disabled'
    )
    expect(Object.keys(JSON.parse(result.env.NODE_REPL_TRUSTED_SERVICES!))).toEqual([
      surface === 'browser' ? 'browser' : 'sky'
    ])
  }
)
test('empty service map and private service module paths are rejected', () => {
  for (const value of ['', JSON.stringify({browser:'@action-driver/browser-runtime/service',
    sky:'@action-driver/sky/service'}), JSON.stringify({browser:'/Applications/Codex.app/service.mjs',
    sky:'/action-driver/computer-service.mjs'})])
    expect(() => createLaunchPlan({ ...base, NODE_REPL_TRUSTED_SERVICES: value },
      instructions, () => 'banner')).toThrow()
})
test('explicit banner override is preserved and banner is not read', () => {
  const read = vi.fn(() => {
    throw new Error('should not read')
  })
  const result = createLaunchPlan(
    { ...base, NODE_REPL_JS_BANNER: '' },
    instructions,
    read
  )
  expect(result.env.NODE_REPL_TRUSTED_SERVICES).toBe(base.NODE_REPL_TRUSTED_SERVICES)
  expect(result.env.NODE_REPL_JS_BANNER).toBe('')
  expect(read).not.toHaveBeenCalled()
})
test('invalid executable or surface configuration never produces a plan', () => {
  for (const env of [
    { ...base, CUA_REPL_NODE_REPL_PATH: 'relative' },
    { ...base, CUA_REPL_ENABLED_SURFACES: undefined },
    { ...base, CUA_REPL_ENABLED_SURFACES: '' },
    { ...base, CUA_REPL_ENABLED_SURFACES: 'browser,unknown' }
  ])
    expect(() => createLaunchPlan(env, instructions, () => 'banner')).toThrow()
})
function fixture(code: number | null = 0, signal: NodeJS.Signals | null = null) {
  const events = new EventEmitter()
  const child = new EventEmitter()
  const killed: unknown[] = []
  const parentSignals: unknown[] = []
  const process = {
    env: base,
    platform: 'darwin',
    pid: 123,
    exitCode: undefined,
    on: events.on.bind(events),
    off: events.off.bind(events),
    kill: (_pid: number, s: NodeJS.Signals) => parentSignals.push(s)
  }
  const host: LaunchHost = {
    process,
    spawn: vi.fn(() => {
      queueMicrotask(() => child.emit('close', code, signal))
      return Object.assign(child, {
        kill: (s?: NodeJS.Signals) => {
          killed.push(s)
          return true
        }
      })
    }),
    loadInstructions: () => instructions,
    readBanner: () => 'banner'
  }
  return { host, events, killed, parentSignals }
}
test('launch spawns inherited IO, cleans listeners and propagates exit code', async () => {
  const { host, events } = fixture(7)
  await launch(host)
  expect(host.spawn).toHaveBeenCalledWith(
    '/node-repl',
    [],
    expect.objectContaining({ stdio: 'inherit' })
  )
  expect(host.process.exitCode).toBe(7)
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) expect(events.listenerCount(s)).toBe(0)
})
test('signals are forwarded and signal exit is reflected to the parent', async () => {
  const f = fixture(null, 'SIGTERM')
  const result = launch(f.host)
  f.events.emit('SIGINT', 'SIGINT')
  await result
  expect(f.killed).toEqual(['SIGINT'])
  expect(f.parentSignals).toEqual(['SIGTERM'])
})
test('spawn errors reject and always release forwarding listeners', async () => {
  const f = fixture()
  f.host.spawn = () => {
    const child = Object.assign(new EventEmitter(), { kill: () => true })
    queueMicrotask(() => child.emit('error', new Error('spawn failed')))
    return child
  }
  await expect(launch(f.host)).rejects.toThrow('spawn failed')
  expect(f.events.listenerCount('SIGINT')).toBe(0)
})
test.each(['linux', 'win32'])(
  'unsupported %s is rejected before resource loading or spawn',
  async (platform) => {
    const f = fixture()
    f.host.process.platform = platform
    const load = vi.fn(() => instructions)
    f.host.loadInstructions = load
    await expect(launch(f.host)).rejects.toThrow('unsupported cua_repl platform')
    expect(load).not.toHaveBeenCalled()
    expect(f.host.spawn).not.toHaveBeenCalled()
  }
)
test.each([null, -1])('missing or negative exit code %s maps to failure', async (code) => {
  const f = fixture(code)
  await launch(f.host)
  expect(f.host.process.exitCode).toBe(1)
})
