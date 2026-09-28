// @vitest-environment node
import { test, expect } from 'vitest'
import { globalCommandHandlers } from '../src/service-global-handlers'
import { originalDocumentation } from './original-service'
test.each([
  'list_browsers',
  'get_browser',
  'get_default_browser',
  'get_browser_for_url',
  'get_browser_documentation',
  'get_documentation'
])('global command %s preserves discovery/read ordering and projections', async (type) => {
  const base = await originalDocumentation()
  async function exercise(handlers: any) {
    const calls: any[] = [],
      browser = {
        id: 'b',
        info: {
          type: 'cdp',
          family: 'chrome',
          name: 'Browser',
          metadata: {
            extensionInstanceId: 'instance',
            codexSessionId: 'session',
            profileName: 'Work',
            secret: 'omit'
          },
          apiSupportOverrides: { 'Tab.ax': false },
          capabilities: {
            tab: [
              { id: 'browserAuth', description: 'auth' },
              { id: 'disabled', description: 'hidden' }
            ],
            browser: [{ id: 'visibility', description: 'visible' }]
          }
        }
      },
      context = {
        refresh: async () => calls.push('refresh'),
        list: async () => {
          calls.push('list')
          return [browser]
        },
        get: async (id: any) => {
          calls.push(['get', id])
          return browser
        },
        getDefault: async () => {
          calls.push('default')
          return browser
        },
        getForUrl: async (url: any) => {
          calls.push(['url', url])
          return browser
        }
      },
      host = { env: { BROWSER_USE_DISABLE_TAB_CAPABILITIES: ' disabled ' } },
      docs = {
        read: async (name: any) => {
          calls.push(['read', name])
          return 'guidance'
        },
        readBrowser: async (info: any) => {
          calls.push(['docs', info])
          return 'API'
        }
      }
    return {
      result: await handlers[type](
        { id: 'b', browser_id: 'b', url: 'https://example.com', name: 'confirmations' },
        context,
        host,
        docs
      ),
      calls
    }
  }
  expect(await exercise(globalCommandHandlers)).toEqual(await exercise(base.baselineGlobalHandlers))
})
