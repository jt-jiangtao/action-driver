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
      'apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-client.mjs'
    )).href)
    const candidate = await exercise(setupBrowserRuntime)
    expect(candidate).toEqual(await exercise(original))
    expect(candidate).toEqual(await exercise(originalModule.setupBrowserRuntime))
  })
test('default runtime requires trusted host and preserves setup rejection identity', async () => {
  vi.stubGlobal('nodeRepl', undefined)
  await expect(setupBrowserRuntime()).rejects.toThrow('requires a trusted Node REPL')
  const error = new Error('setup')
  vi.stubGlobal('nodeRepl', {
    rpc: async () => {
      throw error
    }
  })
  await expect(setupBrowserRuntime()).rejects.toBe(error)
  vi.unstubAllGlobals()
})
