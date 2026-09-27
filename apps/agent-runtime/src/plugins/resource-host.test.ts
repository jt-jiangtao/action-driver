import { expect, it, vi } from 'vitest'
import { PluginResourceHost } from './resource-host'
import type { SupervisedService } from './service-supervisor'
import type { PluginManifest } from '@actiondriver/plugin-contracts'
it('closes a service whose handshake finishes after its owning epoch stopped', async () => {
  const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'old' }
  const dispose = vi.fn(async () => {})
  const service: SupervisedService = { tools: () => [], dispose, onExit() {}, isAvailable: () => true, async call() { return null } }
  let complete!: (service: SupervisedService) => void
  const pending = new Promise<SupervisedService>(resolve => { complete = resolve })
  let stopped = false
  const manifest: PluginManifest = { id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.mjs', platforms: ['darwin-arm64'], activation: [], dependencies: [], contributions: [{ kind: 'service', id: 'fixture.service' }], services: [{ id: 'fixture.service', kind: 'node', entry: 'service.mjs' }] }
  const host = new PluginResourceHost({ supervisor: { start: async () => pending }, ids: () => 'resource', manifest: () => manifest, catalog: () => ({ tools: [], skills: [] }), packageRoot: () => '/fixture', track() { if (stopped) throw new Error('STALE_INSTANCE') }, async failed() {} })
  const registrar = { register: vi.fn(), track() {} }
  const result = host.start(owner, { id: 'fixture.service' }, registrar)
  const rejected = expect(result).rejects.toThrow('STALE_INSTANCE')
  stopped = true; complete(service)
  await rejected
  expect(dispose).toHaveBeenCalledOnce()
  expect(registrar.register).not.toHaveBeenCalled()
  await host.stop(owner, { resourceId: 'resource' })
  expect(dispose).toHaveBeenCalledOnce()
})
