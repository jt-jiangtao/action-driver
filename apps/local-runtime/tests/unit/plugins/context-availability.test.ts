import { expect, it } from 'vitest'
import { PluginManager } from '../../../src/plugins/manager'
import { PluginContextKeys } from '../../../src/plugins/context-keys'

const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'epoch' }
const manifest = {
  id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.js', platforms: ['darwin-arm64'],
  contributions: [{ kind: 'command' as const, id: 'fixture.run', when: 'plugin.fixture.ready' }]
}

it('projects conditional availability without restarting the plugin', async () => {
  const keys = new PluginContextKeys()
  let starts = 0
  const manager = new PluginManager({
    repository: { async publish() {}, async list() { return [] }, async remove() {} },
    factory: { async start(_owner, _manifest, registrar) {
      starts++
      keys.begin(owner)
      registrar.track({ dispose: () => keys.end(owner) })
      registrar.register({ kind: 'command', id: 'fixture.run' })
      return { owner, async stop() {}, async invoke() { return 'ran' } }
    } },
    sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => 'epoch', contextKeys: keys
  })
  await manager.install(manifest)
  await manager.enable('fixture')
  await manager.activate('fixture')
  expect(manager.availableContributions()).toEqual([])
  const invocation = { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' as const }, chain: [] }
  await expect(manager.invoke('fixture.run', null, invocation, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
  keys.setPlugin(owner, 'plugin.fixture.ready', true)
  expect(manager.availableContributions().map(item => item.contribution.id)).toEqual(['fixture.run'])
  await expect(manager.invoke('fixture.run', null, invocation, new AbortController().signal)).resolves.toBe('ran')
  keys.setPlugin(owner, 'plugin.fixture.ready', false)
  expect(manager.availableContributions()).toEqual([])
  await expect(manager.invoke('fixture.run', null, invocation, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
  expect(starts).toBe(1)
  await manager.disable('fixture')
})

it('keeps a started command pinned when its condition turns false', async () => {
  const keys = new PluginContextKeys()
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const manager = new PluginManager({
    repository: { async publish() {}, async list() { return [] }, async remove() {} },
    factory: { async start(_owner, _manifest, registrar) {
      keys.begin(owner)
      registrar.track({ dispose: () => keys.end(owner) })
      registrar.register({ kind: 'command', id: 'fixture.run' })
      return { owner, async stop() {}, async invoke() { await gate; return 'finished' } }
    } },
    sdk: '1.0.0', platform: 'darwin-arm64', epoch: () => 'epoch', contextKeys: keys
  })
  await manager.install(manifest); await manager.enable('fixture'); await manager.activate('fixture')
  keys.setPlugin(owner, 'plugin.fixture.ready', true)
  const invocation = { requestId: 'r', callId: 'started', deadline: Date.now() + 1000, source: { kind: 'runtime' as const }, chain: [] }
  const running = manager.invoke('fixture.run', null, invocation, new AbortController().signal)
  keys.setPlugin(owner, 'plugin.fixture.ready', false)
  await expect(manager.invoke('fixture.run', null, { ...invocation, callId: 'next' }, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
  finish()
  await expect(running).resolves.toBe('finished')
  await manager.disable('fixture')
})
