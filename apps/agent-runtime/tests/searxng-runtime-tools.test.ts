import { describe, expect, it } from 'vitest'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { activate } from '../../../plugins/search/src/extension'
import { catalog } from '../../../plugins/search/src/catalog'
import { createPluginContext } from '@actiondriver/plugin-sdk'
describe('SearXNG plugin registration', () => {
  it('keeps discovery separate from availability and task grants', async () => {
    const registry = new RuntimeToolRegistry(), grants: string[] = []
    const owner = { pluginId: 'search', version: '1.0.0', hostEpoch: 'test' }
    let configuration: { endpoint: string } | null = null
    const context = createPluginContext(owner, { tools: { register: (definition, executor) => registry.register(definition, executor, owner) }, registrations: { register() { throw new Error('Unexpected contribution') } }, transport: { async request() { return configuration } } })
    expect(catalog.tools[0]?.id).toBe('web.search')
    await activate(context)
    expect(registry.list()).toEqual([])
    configuration = { endpoint: 'http://127.0.0.1:8080' }
    await activate(context)
    expect(registry.resolve('web.search', 1).owner).toEqual(owner)
    expect(grants).toEqual([])
    await context.subscriptions.dispose()
    expect(registry.list()).toEqual([])
  })
  it('rejects non-loopback configuration without registering a partial tool', async () => {
    const registry = new RuntimeToolRegistry()
    const context = createPluginContext({ pluginId: 'search', version: '1.0.0', hostEpoch: 'test' }, { tools: { register: (definition, executor) => registry.register(definition, executor) }, registrations: { register() { throw new Error('Unexpected') } }, transport: { async request() { return { endpoint: 'http://localhost:8080' } } } })
    await expect(activate(context)).rejects.toThrow('SEARXNG_ENDPOINT_INVALID')
    expect(registry.list()).toEqual([])
  })
})
