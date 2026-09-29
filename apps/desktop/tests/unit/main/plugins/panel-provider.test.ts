import { expect, it, vi } from 'vitest'
import { createPluginPanelProvider } from '../../../../src/main/plugins/panel-provider'
import { PluginPanelHost } from '../../../../src/main/plugins/panel-host'
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

it('routes view declarations and view opens through the same bound host', async () => {
  const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'first' }, dispose = vi.fn()
  const manifest: PluginManifest = {
    id: 'fixture', version: '1.0.0', sdk: '^1.0.0', entry: 'extension.js', platforms: [`${process.platform}-${process.arch}`], activation: [], dependencies: [],
    contributions: [{ kind: 'view', id: 'fixture.dashboard' }, { kind: 'menu', id: 'fixture.refresh-menu' }, { kind: 'command', id: 'fixture.refresh' }],
    views: [{ id: 'fixture.dashboard', title: 'Dashboard', container: 'sidebar', entry: 'ui/dashboard.html', messages: {} }],
    menus: [{ id: 'fixture.refresh-menu', title: '刷新', command: 'fixture.refresh', location: 'plugins-menu' }]
  }
  const bridge = createPluginPanelProvider({ loadManifest: async () => manifest, createHost: ports => { const host = new PluginPanelHost({ ...ports, ids: () => 'view', create: async () => ({ dispose }), message: async () => null, supportedViewContainers: () => ['sidebar'] }); return { host, dispose: () => host.dispose() } } })
  const request = (input: unknown) => bridge.provider.execute(input)
  await request({ operation: 'bind', owner })
  expect(await request({ operation: 'request', owner, method: 'views.open', payload: { id: 'fixture.dashboard' } })).toEqual({ resourceId: 'view' })
  await expect(request({ operation: 'request', owner, method: 'views.open', payload: { id: 'fixture.unknown' } })).rejects.toThrow('PROTOCOL_ERROR')
  await bridge.disconnected()
  expect(dispose).toHaveBeenCalledOnce()
})
