// @vitest-environment node
import { expect, test } from 'vitest'
import { Browser, Tab, browserCapabilityDefinitions, tabCapabilityDefinitions } from '../src/index'
import { originalClient } from './original-client'
test('default browser capability registry and selected tab capabilities match original', async () => {
  const { baselineApi } = await originalClient()
  expect(browserCapabilityDefinitions.map((d) => d.info)).toEqual(
    baselineApi.browserCapabilityDefinitions.map((d: any) => d.info)
  )
  expect(tabCapabilityDefinitions.map((d) => d.info)).toEqual(
    baselineApi.tabCapabilityDefinitions.map((d: any) => d.info)
  )
  async function exercise(Type: any) {
    const calls: unknown[] = []
    const browser = new Type({
      browserId: 'b',
      capabilities: {
        browser: [
          { id: 'visibility', description: 'override' },
          { id: 'viewport' },
          { id: 'unknown' }
        ],
        tab: [
          { id: 'cdp' },
          { id: 'botDetection' },
          { id: 'browserAuth' },
          { id: 'pageAssets' },
          { id: 'webmcp' },
          { id: 'unknown' }
        ]
      },
      transport: {
        async send(req: any) {
          calls.push(req.command.toJSON())
          return { id: 't' }
        }
      }
    })
    const tab = await browser.tabs.get('t')
    return {
      browserKeys: Object.keys(browser),
      tabKeys: Object.keys(tab),
      browserInfo: await browser.capabilities.list(),
      tabInfo: await tab.capabilities.list(),
      docs: await (await tab.capabilities.get('cdp')).documentation(),
      calls
    }
  }
  expect(await exercise(Browser)).toEqual(await exercise(baselineApi.Browser))
})
test('default Tab registry can be constructed independently and ignores unknown capabilities', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Type: any) {
    const tab = new Type({
      browserId: 'b',
      tabPayload: { id: 't' },
      capabilities: [{ id: 'webmcp' }, { id: 'bad' }],
      documentation: { get: async (x: string) => x },
      transport: { send: async () => ({ tools: [] }) }
    })
    const cap = await tab.capabilities.get('webmcp')
    return {
      info: await tab.capabilities.list(),
      description: (await cap.fetchTools()).description()
    }
  }
  expect(await exercise(Tab)).toEqual(await exercise(baselineApi.Tab))
})
