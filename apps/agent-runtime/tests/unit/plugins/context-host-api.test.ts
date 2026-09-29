import { expect, it } from 'vitest'
import { PluginHostAPI } from '../../../src/plugins/host-api'
import { PluginContextKeys } from '../../../src/plugins/context-keys'

it('accepts only current plugin-owned context updates through host API', async () => {
  const owner = { pluginId: 'fixture', version: '1.0.0', hostEpoch: 'one' }
  const keys = new PluginContextKeys()
  keys.begin(owner)
  const api = new PluginHostAPI({ assertInstance() {}, authority() { throw new Error('unused') }, context: keys })
  await api.request(owner, 'context.set', { key: 'plugin.fixture.ready', value: true })
  expect(keys.snapshot().values['plugin.fixture.ready']).toBe(true)
  await expect(api.request(owner, 'context.set', { key: 'host.online', value: true })).rejects.toThrow()
  await api.request(owner, 'context.remove', { key: 'plugin.fixture.ready' })
  expect(keys.snapshot().values).toEqual({})
})
