import { expect, it } from 'vitest'
import { createPluginContext } from '../../src/context'

it('sends plugin-owned context key updates through the host transport', async () => {
  const requests: unknown[] = []
  const context = createPluginContext({ pluginId: 'fixture', version: '1.0.0', hostEpoch: 'e' }, {
    registrations: { register() { return { dispose() {} } } }, tools: { register() { return { dispose() {} } } },
    transport: { async request(method, payload) { requests.push({ method, payload }); return null } }
  })
  await context.api.context.set('plugin.fixture.ready', true)
  await context.api.context.remove('plugin.fixture.ready')
  expect(requests).toEqual([
    { method: 'context.set', payload: { key: 'plugin.fixture.ready', value: true } },
    { method: 'context.remove', payload: { key: 'plugin.fixture.ready' } }
  ])
})
