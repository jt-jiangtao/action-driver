// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupBrowserRuntime } from '../src/index'
import { originalClient } from './original-client'
for (const disabled of [[], ['Tab.ax', 'Tab.cua']])
  test(`default runtime composes real candidate classes with manifest filtering ${disabled}`, async () => {
    const { setupBrowserRuntime: original } = await originalClient()
    async function exercise(setup: any) {
      const calls: unknown[] = [],
        decorated: unknown[] = []
      vi.stubGlobal('nodeRepl', {
        emitImage: async () => {},
        rpc: async (service: string, request: any) => {
          calls.push({ service, request })
          if (request.method === 'setup')
            return {
              apiManifest: {
                interfaces: {
                  Agent: {},
                  Browsers: {},
                  Browser: {},
                  Tabs: {},
                  Tab: { ax: {}, cua: {} },
                  CdpTabCapability: {}
                }
              },
              disabledMemberIds: disabled
            }
          switch (request.params.type) {
            case 'get_browser':
              return {
                id: 'b',
                type: 'iab',
                capabilities: { browser: [{ id: 'visibility' }], tab: [{ id: 'cdp' }] }
              }
            case 'get_tab':
              return { id: 't' }
            case 'tab_cdp_events':
              return { cursor: 0, events: [], hasMore: false, truncated: false }
            case 'get_browser_documentation':
              return 'docs'
            default:
              return {}
          }
        }
      })
      try {
        const agent = await setup({
          ...(setup === setupBrowserRuntime ? {
            host: {
              setup: (params: unknown) => (globalThis as any).nodeRepl.rpc('browser', { method: 'setup', params }),
              execute: (params: unknown) => (globalThis as any).nodeRepl.rpc('browser', { method: 'execute', params }),
              displayImage: (bytes: Uint8Array) => (globalThis as any).nodeRepl.emitImage(bytes),
              close: async () => {}
            }
          } : {}),
          decorateTab: (tab: any) => decorated.push({ id: tab.id, ax: typeof tab.ax })
        })
        const browser = await agent.browsers.get('b')
        const tab = await browser.tabs.get('t')
        const cdp = await tab.capabilities.get('cdp')
        return {
          events: await cdp.readEvents({ timeoutMs: 5 }),
          docs: await browser.documentation(),
          ax: typeof tab.ax,
          cua: typeof tab.cua,
          decorated,
          calls
        }
      } finally {
        vi.unstubAllGlobals()
      }
    }
    const originalModule = await import(pathToFileURL(resolve(
      'packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.mjs'
    )).href)
    const candidate = await exercise(setupBrowserRuntime)
    expect(candidate).toEqual(await exercise(original))
    expect(candidate).toEqual(await exercise(originalModule.setupBrowserRuntime))
  })
test('default runtime requires an explicit host and preserves setup rejection identity', async () => {
  vi.stubGlobal('nodeRepl', undefined)
  await expect(setupBrowserRuntime()).rejects.toThrow('BROWSER_HOST_UNAVAILABLE')
  const error = new Error('setup')
  await expect(setupBrowserRuntime({ host: {
    setup: async () => { throw error },
    execute: async () => ({}),
    displayImage: async () => {},
    close: async () => {}
  } })).rejects.toBe(error)
  vi.unstubAllGlobals()
})
