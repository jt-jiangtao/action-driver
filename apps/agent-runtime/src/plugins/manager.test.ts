import { describe, expect, it } from 'vitest'
import { PluginManager } from './manager'
import type { PluginHostFactory, PluginRepository, HostInstance, ContributionRegistrar } from './ports'
import type { PluginManifest } from '@actiondriver/plugin-contracts'

const manifest: PluginManifest = { id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'index.js', platforms: ['darwin-arm64'], activation: [], contributions: [{ kind: 'tool', id: 'fixture.read', modelName: 'fixture_read' }], dependencies: [] }
function fixture(options: { fail?: boolean; wait?: Promise<void> } = {}) {
  let starts = 0, stops = 0
  const records = new Map<string, PluginManifest>()
  const repository: PluginRepository = {
    async publish(value) { records.set(value.id, value) },
    async list() { return [...records.values()] },
    async remove(id) { records.delete(id) }
  }
  const factory: PluginHostFactory = {
    async start(owner, _manifest, registrar) {
      starts++
      registrar.register(manifest.contributions[0]!)
      registrar.track({ async dispose() { stops++ } })
      if (options.wait) await options.wait
      if (options.fail) throw new Error('activation failed')
      const instance: HostInstance = { owner, async stop() {}, async invoke() { return 'result' } }
      return instance
    }
  }
  const manager = new PluginManager({ repository, factory, sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => `epoch-${starts + 1}` })
  return { manager, records, starts: () => starts, stops: () => stops }
}
describe('plugin lifecycle', () => {
  it('installs disabled and publishes only after single-flight activation completes', async () => {
    let finish!: () => void
    const f = fixture({ wait: new Promise<void>(resolve => { finish = resolve }) })
    await f.manager.install(manifest)
    expect(f.manager.status('fixture')).toBe('disabled')
    await f.manager.enable('fixture')
    const first = f.manager.activate('fixture'), second = f.manager.activate('fixture')
    expect(f.manager.contributions()).toEqual([])
    finish()
    await Promise.all([first, second])
    expect(f.starts()).toBe(1)
    expect(f.manager.contributions()[0]?.owner).toEqual({ pluginId: 'fixture', version: '1.0.0', hostEpoch: 'epoch-1' })
    await f.manager.disable('fixture')
    expect(f.manager.contributions()).toEqual([])
    expect(f.stops()).toBe(1)
  })
  it('rolls back staged registrations and resources if activation fails', async () => {
    const f = fixture({ fail: true })
    await f.manager.install(manifest); await f.manager.enable('fixture')
    await expect(f.manager.activate('fixture')).rejects.toThrow('activation failed')
    expect(f.manager.status('fixture')).toBe('failed')
    expect(f.manager.contributions()).toEqual([])
    expect(f.stops()).toBe(1)
  })
  it('rejects conflicts with both owners without replacing existing contributions', async () => {
    const f = fixture()
    await f.manager.install(manifest); await f.manager.enable('fixture'); await f.manager.activate('fixture')
    await f.manager.install({ ...manifest, id: 'other' }); await f.manager.enable('other')
    await expect(f.manager.activate('other')).rejects.toThrow(/fixture.*other|other.*fixture/)
    expect(f.manager.contributions()).toHaveLength(1)
  })
  it('rejects old instance registrations after disable and restart', async () => {
    const f = fixture()
    await f.manager.install(manifest); await f.manager.enable('fixture'); await f.manager.activate('fixture')
    const old = f.manager.contributions()[0]!.owner
    await f.manager.disable('fixture'); await f.manager.enable('fixture'); await f.manager.activate('fixture')
    expect(() => f.manager.assertInstance(old)).toThrow('STALE_INSTANCE')
    expect(f.manager.contributions()[0]!.owner.hostEpoch).toBe('epoch-2')
  })
  it('never starts hosts with missing dependencies', async () => {
    const f = fixture()
    await f.manager.install({ ...manifest, dependencies: [{ id: 'missing', version: '^1.0.0', optional: false }] })
    await expect(f.manager.enable('fixture')).rejects.toThrow('DEPENDENCY_MISSING')
    expect(f.starts()).toBe(0)
  })
})
describe('pinned invocation and upgrades', () => {
  it('waits for the old invocation before replacing its version', async () => {
    let finish!: (value: string) => void
    let invoked = false
    const repository: PluginRepository = { async publish() {}, async list() { return [] }, async remove() {} }
    let epoch = 0
    const manager = new PluginManager({ repository, sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => String(++epoch), factory: {
      async start(owner, value, registrar) {
        registrar.register(value.contributions[0]!)
        return { owner, async stop() {}, async invoke() { invoked = true; return new Promise<string>(resolve => { finish = resolve }) } }
      }
    } })
    await manager.install(manifest); await manager.enable('fixture'); await manager.activate('fixture')
    const call = manager.invoke('fixture.read', null, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)
    expect(invoked).toBe(true)
    const upgrade = manager.upgrade('fixture', { ...manifest, version: '1.1.0' })
    expect(manager.status('fixture')).toBe('stopping')
    await expect(manager.invoke('fixture.read', null, { requestId: 'r2', callId: 'c2', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
    finish('old-result')
    expect(await call).toBe('old-result')
    await upgrade
    expect(manager.contributions()[0]?.owner.version).toBe('1.1.0')
  })
  it('refuses irreversible migration without backup and restore before stopping the old host', async () => {
    const f = fixture()
    await f.manager.install(manifest); await f.manager.enable('fixture'); await f.manager.activate('fixture')
    await expect(f.manager.upgrade('fixture', { ...manifest, version: '2.0.0' }, { irreversible: true })).rejects.toThrow('MIGRATION_UNSAFE')
    expect(f.manager.status('fixture')).toBe('ready')
  })
})
describe('bounded stop and crash cleanup', () => {
  it('cancels an uncooperative call, recycles all resources and reports an unknown result', async () => {
    let cancelled = false, closed = false
    const manager = new PluginManager({ stopTimeoutMs: 5, sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => 'epoch', repository: { async publish() {}, async list() { return [] }, async remove() {} }, factory: {
      async start(owner, value, registrar) {
        registrar.register(value.contributions[0]!)
        registrar.track({ dispose() { closed = true } })
        return { owner, async stop() {}, async invoke(_id, _input, _context, signal) { signal.addEventListener('abort', () => { cancelled = true }); return new Promise(() => {}) } }
      }
    } })
    await manager.install(manifest); await manager.enable('fixture'); await manager.activate('fixture')
    const call = manager.invoke('fixture.read', null, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)
    const outcome = expect(call).rejects.toThrow('RESULT_UNKNOWN')
    await manager.disable('fixture'); await outcome
    expect(cancelled).toBe(true); expect(closed).toBe(true)
    expect(manager.status('fixture')).toBe('disabled')
  })
  it('removes contributions on host failure without replaying business calls', async () => {
    let exited!: () => void, executions = 0
    const manager = new PluginManager({ sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => 'epoch', repository: { async publish() {}, async list() { return [] }, async remove() {} }, factory: {
      async start(owner, value, registrar) {
        registrar.register(value.contributions[0]!)
        return { owner, onExit(handler) { exited = handler }, async stop() {}, async invoke() { executions++; return 'ok' } }
      }
    } })
    await manager.install(manifest); await manager.enable('fixture'); await manager.activate('fixture')
    exited()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(manager.status('fixture')).toBe('failed')
    expect(manager.contributions()).toEqual([])
    expect(executions).toBe(0)
  })
})
it('publishes late declared contributions and withdraws them when their resource closes', async () => {
  let registrar!: ContributionRegistrar
  const live = new Set<string>()
  const manager = new PluginManager({ sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => 'e', repository: { async publish() {}, async list() { return [] }, async remove() {} }, factory: { async start(owner, _manifest, registration) { registrar = registration; return { owner, async stop() {}, async invoke() { return null } } } }, publish: (_owner, contributions) => contributions.map(contribution => { live.add(contribution.id); return { dispose() { live.delete(contribution.id) } } }), withdraw: (_owner, contribution) => { live.delete(contribution.id) } })
  await manager.install(manifest); await manager.enable(manifest.id); await manager.activate(manifest.id)
  registrar.register(manifest.contributions[0]!)
  expect(manager.contributions()).toHaveLength(1)
  expect([...live]).toEqual(['fixture.read'])
  registrar.unregister!(manifest.contributions[0]!)
  expect(manager.contributions()).toEqual([])
  expect(live.size).toBe(0)
  await manager.disable(manifest.id)
})
it('waits for crashed epoch cleanup before allowing a replacement activation', async () => {
  let exit!: () => void, stopped!: () => void, starts = 0
  const gate = new Promise<void>(resolve => { stopped = resolve })
  const manager = new PluginManager({ sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => String(++starts), repository: { async publish() {}, async list() { return [] }, async remove() {} }, factory: { async start(owner, _manifest, registration) { registration.register(manifest.contributions[0]!); return { owner, onExit(handler) { exit = handler }, async stop() { if (owner.hostEpoch === '1') await gate }, async invoke() { return owner.hostEpoch } } } } })
  await manager.install(manifest); await manager.enable(manifest.id); await manager.activate(manifest.id)
  exit()
  let enabled = false
  const restarting = manager.enable(manifest.id).then(() => { enabled = true; return manager.activate(manifest.id) })
  await Promise.resolve()
  expect(enabled).toBe(false)
  stopped(); await restarting
  expect(manager.status(manifest.id)).toBe('ready')
  expect(await manager.invoke('fixture.read', null, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)).toBe('2')
  await manager.disable(manifest.id)
})
