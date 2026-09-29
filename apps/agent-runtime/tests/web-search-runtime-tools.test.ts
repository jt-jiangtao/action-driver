import { describe, expect, it } from 'vitest'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { activate } from '../../../plugins/web/src/search/extension'
import { catalog } from '../../../plugins/web/src/search/catalog'
import { createPluginContext } from '@actiondriver/plugin-sdk'
describe('web search plugin registration', () => {
  it('keeps discovery separate from availability and task grants', async () => {
    const registry = new RuntimeToolRegistry(), grants: string[] = []
    const owner = { pluginId: 'search', version: '1.0.0', hostEpoch: 'test' }
    let configuration: { searchConfigured: boolean } | null = null
    const context = createPluginContext(owner, { tools: { register: (definition, executor) => registry.register(definition, executor, owner) }, registrations: { register() { throw new Error('Unexpected contribution') } }, transport: { async request() { return configuration } } })
    expect(catalog.tools[0]?.id).toBe('tools/local/web/search')
    await activate(context)
    expect(registry.list()).toEqual([])
    configuration = { searchConfigured: true }
    await activate(context)
    expect(registry.resolve('tools/local/web/search', 1).owner).toEqual(owner)
    expect(grants).toEqual([])
    await context.subscriptions.dispose()
    expect(registry.list()).toEqual([])
  })
  it('does not enable Tavily from unrelated configuration', async () => {
    const registry = new RuntimeToolRegistry()
    const context = createPluginContext({ pluginId: 'search', version: '1.0.0', hostEpoch: 'test' }, { tools: { register: (definition, executor) => registry.register(definition, executor) }, registrations: { register() { throw new Error('Unexpected') } }, transport: { async request() { return { unrelated: true } } } })
    await activate(context)
    expect(registry.list()).toEqual([])
  })
})
