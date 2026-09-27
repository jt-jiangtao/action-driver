import { expect, it, vi } from 'vitest'
import { createPluginPanelProvider } from './panel-provider'
import { PluginPanelHost } from './panel-host'
import type { PluginManifest } from '@actiondriver/plugin-contracts'
it('binds declared panel resources to one epoch and closes them on bridge loss', async () => {
  const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'first' }, dispose = vi.fn()
  const manifest: PluginManifest = { id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.js', platforms: [`${process.platform}-${process.arch}`], contributions: [{ kind: 'panel', id: 'fixture.view' }], panels: [{ id: 'fixture.view', entry: 'ui/index.html', messages: {} }], activation: [], dependencies: [] }
  const bridge = createPluginPanelProvider({ loadManifest: async () => manifest, createHost: ports => { const host = new PluginPanelHost({ ...ports, ids: () => 'panel', create: async () => ({ dispose }), message: async () => null }); return { host, dispose: () => host.dispose() } } })
  const request = (input: unknown) => bridge.provider.execute(input)
  await expect(request({ operation: 'request', owner, method: 'panels.open', payload: { id: 'fixture.view' } })).rejects.toThrow('STALE_INSTANCE')
  await request({ operation: 'bind', owner })
  expect(await request({ operation: 'request', owner, method: 'panels.open', payload: { id: 'fixture.view' } })).toEqual({ resourceId: 'panel' })
  await request({ operation: 'bind', owner: { ...owner, hostEpoch: 'next' } })
  expect(dispose).toHaveBeenCalledOnce()
  await expect(request({ operation: 'release', owner })).rejects.toThrow('STALE_INSTANCE')
  await request({ operation: 'request', owner: { ...owner, hostEpoch: 'next' }, method: 'panels.open', payload: { id: 'fixture.view' } })
  await bridge.disconnected()
  expect(dispose).toHaveBeenCalledTimes(2)
  await expect(request({ operation: 'request', owner: { ...owner, hostEpoch: 'next' }, method: 'panels.open', payload: { id: 'fixture.view' } })).rejects.toThrow('STALE_INSTANCE')
})
