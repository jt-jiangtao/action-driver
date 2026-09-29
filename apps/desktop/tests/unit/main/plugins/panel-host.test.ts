import { expect, it, vi } from 'vitest'
import { PluginPanelHost, type PanelHostPorts } from '../../../../src/main/plugins/panel-host'
const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'first' }
it('owns panel surfaces, validates declared messages and closes on owner disposal', async () => {
  const dispose = vi.fn(), message = vi.fn(async () => ({ viewed: true }))
  const create = vi.fn<PanelHostPorts['create']>(async () => ({ dispose }))
  const host = new PluginPanelHost({ assertInstance() {}, ids: () => 'panel', create, declarations: () => [{ id: 'fixture.view', url: 'https://example.test/view', messages: { inspect: { type: 'object', properties: {}, additionalProperties: false } } }], message })
  await host.open(owner, 'fixture.view')
  expect(create.mock.calls[0]?.[0].preferences).toEqual({ sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true })
  await expect(host.receive('panel', { ...owner, hostEpoch: 'old' }, 'inspect', {})).rejects.toThrow('STALE_INSTANCE')
  await expect(host.receive('panel', owner, 'control', {})).rejects.toThrow('PROTOCOL_ERROR')
  await expect(host.receive('panel', owner, 'inspect', { control: true })).rejects.toThrow('PROTOCOL_ERROR')
  expect(await host.receive('panel', owner, 'inspect', {})).toEqual({ viewed: true })
  expect(message).toHaveBeenCalledTimes(1)
  await host.disposeOwner(owner)
  expect(dispose).toHaveBeenCalledOnce()
  await expect(host.receive('panel', owner, 'inspect', {})).rejects.toThrow('UNAVAILABLE')
})

it('renders declared views only in supported containers and rejects unknown ones diagnosably', async () => {
  const dispose = vi.fn()
  const create = vi.fn<PanelHostPorts['create']>(async () => ({ dispose }))
  const host = new PluginPanelHost({
    assertInstance() {}, ids: () => 'view', create, declarations: () => [],
    supportedViewContainers: () => ['sidebar', 'window'],
    viewDeclarations: () => [
      { id: 'fixture.sidebar', title: 'Sidebar', container: 'sidebar', entry: 'ui/sidebar.html', messages: {} },
      { id: 'fixture.unsupported', title: 'Task', container: 'task-panel', entry: 'ui/task.html', messages: {} },
      { id: 'fixture.raw', title: 'Raw', container: 'sidebar', entry: 'ui/raw.html', messages: {}, script: 'globalThis.node = require' } as never
    ],
    message: async () => null
  })
  expect(await host.openView(owner, 'fixture.sidebar')).toEqual({ resourceId: 'view' })
  expect(create.mock.calls[0]?.[0].definition.id).toBe('fixture.sidebar')
  await expect(host.openView(owner, 'fixture.unsupported')).rejects.toThrow('UNAVAILABLE')
  await expect(host.openView(owner, 'fixture.unsupported')).rejects.toThrow(/task-panel/)
  await expect(host.openView(owner, 'fixture.missing')).rejects.toThrow('PROTOCOL_ERROR')
  // Declarations may not smuggle renderer scripts or other extra fields into the surface.
  await expect(host.openView(owner, 'fixture.raw')).rejects.toThrow()
  await host.disposeOwner(owner)
  expect(dispose).toHaveBeenCalledOnce()
})
