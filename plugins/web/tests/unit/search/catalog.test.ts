import { describe, expect, it } from 'vitest'
import { catalog } from '../../../src/search/catalog'
import { activate } from '../../../src/search/extension'
import { createPluginContext } from '@actiondriver/plugin-sdk'
describe('search plugin catalog and lifecycle', () => {
  it('exposes a complete schema before configuration or activation without granting tools', () => {
    expect(catalog.tools[0]).toMatchObject({ id: 'tools/local/web/search', version: 1, modelName: 'tools_local_web_search', inputSchema: { required: ['query'], additionalProperties: false } })
    expect(catalog.skills).toEqual([])
  })
  it('does not register an executable tool when the service is not configured', async () => {
    const live: string[] = []
    const context = createPluginContext({ pluginId: 'search', version: '1.0.0', hostEpoch: 's' }, {
      tools: { register(definition) { live.push(definition.id); return { dispose() {} } } }, registrations: { register() { throw new Error('unexpected') } }, transport: { async request() { return null } }
    })
    await activate(context)
    expect(live).toEqual([])
  })
})
