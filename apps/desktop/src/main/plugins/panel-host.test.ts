import { expect, it, vi } from 'vitest'
import { PluginPanelHost, type PanelHostPorts } from './panel-host'
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
