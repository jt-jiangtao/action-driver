import { describe, expect, it } from 'vitest'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { registerSearxngTool } from '../src/searxng/runtime-tools'

describe('SearXNG runtime registration', () => {
  it('does not expose search without an endpoint and grants it only after a valid endpoint is configured', () => {
    const missing = { registry: new RuntimeToolRegistry(), grants: [] as string[] }
    registerSearxngTool(missing, undefined)
    expect(missing.registry.list()).toEqual([])
    expect(missing.grants).toEqual([])

    const configured = { registry: new RuntimeToolRegistry(), grants: [] as string[] }
    registerSearxngTool(configured, 'http://127.0.0.1:8080')
    expect(configured.registry.list()).toMatchObject([{ id: 'web.search', modelName: 'web_search' }])
    expect(configured.grants).toEqual(['web.search@1'])
  })

  it('fails startup configuration rather than allowing a non-loopback search target', () => {
    expect(() => registerSearxngTool(
      { registry: new RuntimeToolRegistry(), grants: [] },
      'http://localhost:8080'
    )).toThrow('SEARXNG_ENDPOINT_INVALID')
  })
})

