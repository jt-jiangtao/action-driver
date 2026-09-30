import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { NodePluginHostFactory } from '../../../src/plugins/process-host'
import type { PluginManifest } from '@action-driver/plugin-contracts'
const manifest: PluginManifest = { id: 'external-fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'external.mjs', platforms: ['darwin-arm64'], activation: [], contributions: [{ kind: 'capability', id: 'external-fixture.echo' }], dependencies: [] }
describe('process plugin host', () => {
  it('activates an external module using injected public context and closes its process', async () => {
    const factory = new NodePluginHostFactory({
      executable: process.execPath,
      hostEntry: resolve('apps/local-runtime/src/plugins/host-entry.mjs'),
      packageRoot: () => resolve('apps/local-runtime/src/plugins/fixtures'),
      token: () => 'fixture-secret',
      request: async () => null
    })
    const registered: string[] = []
    const owner = { pluginId: manifest.id, version: manifest.version, hostEpoch: 'first' }
    const host = await factory.start(owner, manifest, { register: contribution => registered.push(contribution.id), track: () => {} })
    try {
      expect(registered).toEqual(['external-fixture.echo'])
      expect(await host.invoke('external-fixture.echo', { value: 'hello' }, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)).toEqual({ value: 'hello', plugin: 'external-fixture', call: 'c' })
    } finally { await host.stop('shutdown') }
    await expect(host.invoke('external-fixture.echo', null, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, new AbortController().signal)).rejects.toThrow('UNAVAILABLE')
  })
})

it('bounds cancellation of an uncooperative host and reports an unknown result', async () => {
  const factory = new NodePluginHostFactory({ executable: process.execPath, hostEntry: resolve('apps/local-runtime/src/plugins/host-entry.mjs'), packageRoot: () => resolve('apps/local-runtime/src/plugins/fixtures'), token: () => 'secret', request: async () => null, cancellationGraceMs: 30 })
  const host = await factory.start({ pluginId: manifest.id, version: manifest.version, hostEpoch: 'cancel' }, manifest, { register() {}, track() {} })
  try {
    const controller = new AbortController()
    const call = host.invoke('external-fixture.echo', { hang: true }, { requestId: 'r', callId: 'c', deadline: Date.now() + 1000, source: { kind: 'runtime' }, chain: [] }, controller.signal)
    const rejected = expect(call).rejects.toThrow('RESULT_UNKNOWN')
    controller.abort()
    await rejected
  } finally { await host.stop('shutdown') }
})
