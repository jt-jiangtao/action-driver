// @vitest-environment node
import { test, expect } from 'vitest'
import { ComposedTab, ComposedBrowser } from '../src/composition'
import { originalClient } from './original-client'

async function compare(run: (types: any, registries: any) => Promise<unknown>) {
  const { baselineApi, baselineTabFactories, baselineBrowserFactories } = await originalClient()
  const registries = {
    tabFactories: baselineTabFactories,
    browserFactories: baselineBrowserFactories
  }
  expect(await run({ Tab: ComposedTab, Browser: ComposedBrowser }, registries)).toEqual(
    await run(baselineApi, registries)
  )
}
const transport = {
  async send({ command }: any) {
    const input = command.toJSON()
    if (input.type === 'get_tab') return { id: input.tab_id || 't', title: 'title' }
    if (input.type === 'create_tab') return { id: 'new' }
    if (input.type === 'selected_tab') return { id: 'selected' }
    if (input.type === 'browser_user_claim_tab') return { id: 'claimed' }
    return 'documentation'
  },
  async display() {}
}
test('Tab composes all subinterfaces in original public member order', async () => {
  await compare(async (types, registries) => {
    const tab = new types.Tab({
      browserId: 'b',
      transport,
      tabPayload: { id: 't', extra: 'ignored' },
      ...registries
    })
    return {
      keys: Object.keys(tab),
      title: await tab.title(),
      capabilities: await tab.capabilities.list(),
      extras: tab.extra,
      methods: [
        tab.playwright.getByRole,
        tab.dom_cua.get_visible_dom,
        tab.cua.click,
        tab.ax.get,
        tab.content.export,
        tab.clipboard.read,
        tab.dev.logs
      ].map((x) => typeof x)
    }
  })
})
test('Tab controls use mutated id while subinterfaces retain their initial scope', async () => {
  await compare(async (types, registries) => {
    const calls: any[] = []
    const tab = new types.Tab({
      browserId: 'b',
      tabPayload: { id: 't' },
      ...registries,
      transport: {
        async send({ command }: any) {
          calls.push(command.toJSON())
          return {}
        },
        async display() {}
      }
    })
    tab.id = 'changed'
    await tab.goto('https://example.test')
    await tab.cua.click({ x: 1, y: 2 })
    return calls
  })
})
test('capability selection skips unknown entries and preserves registered metadata', async () => {
  await compare(async (types, registries) => {
    const documentation = { get: async (name: string) => name }
    const capabilities = [
      { id: 'unknown', description: 'skip' },
      { id: 'cdp', description: 'old' },
      { id: 'cdp', description: 'last' }
    ]
    const tab = new types.Tab({
      browserId: 'b',
      tabPayload: { id: 't' },
      transport,
      documentation,
      capabilities,
      ...registries
    })
    const list = await tab.capabilities.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('cdp')
    expect(list[0]).not.toBe(capabilities[2])
    return { list, same: list[0] === capabilities[2] }
  })
})
test('Browser composes tabs/user collections and capability metadata with captured browser identity', async () => {
  await compare(async (types, registries) => {
    const browser = new types.Browser({
      browserId: 'b',
      transport,
      capabilities: {
        browser: [
          { id: 'visibility', description: 'visible' },
          { id: 'unknown', description: 'skip' }
        ]
      },
      ...registries
    })
    browser.browserId = 'changed'
    const tabs = [
      await browser.tabs.new(),
      await browser.tabs.selected(),
      await browser.tabs.get('t'),
      await browser.user.claimTab('u')
    ]
    return {
      keys: Object.keys(browser),
      tabIds: tabs.map((tab) => tab.id),
      caps: await browser.capabilities.list(),
      docs: await browser.capabilities.get('visibility').then((cap: any) => cap.documentation())
    }
  })
})
test('Browser tab factory reads current capability list from captured configuration', async () => {
  await compare(async (types, registries) => {
    const capabilities = { tab: [{ id: 'unknown', description: 'initial' }] }
    const browser = new types.Browser({ browserId: 'b', transport, capabilities, ...registries })
    const before = await browser.tabs.get('before')
    capabilities.tab = [{ id: 'cdp', description: 'later' }]
    const after = await browser.tabs.get('after')
    return {
      before: await before.capabilities.list(),
      after: await after.capabilities.list(),
      same: before === after
    }
  })
})
test('Tab composition rejects missing ids before reading unrelated configuration', async () => {
  await compare(async (types, registries) => {
    const events: string[] = []
    try {
      new types.Tab({
        browserId: 'b',
        tabPayload: {},
        transport,
        ...registries,
        get unused() {
          events.push('unused')
          throw Error('unused')
        }
      })
    } catch (error) {
      return { message: (error as Error).message, events }
    }
  })
})
test('missing transport keeps all subinterfaces but fails bound Tab operations identically', async () => {
  await compare(async (types, registries) => {
    const tab = new types.Tab({ browserId: 'b', tabPayload: { id: 't' }, ...registries })
    try {
      await tab.title()
    } catch (error) {
      return {
        message: (error as Error).message,
        keys: Object.keys(tab),
        capabilities: await tab.capabilities.list()
      }
    }
  })
})
test('Browser tab collections produce candidate subinterfaces that execute original commands', async () => {
  await compare(async (types, registries) => {
    const calls: unknown[] = []
    const browser = new types.Browser({
      browserId: 'b',
      ...registries,
      transport: {
        async send({ command }: any) {
          const input = command.toJSON()
          calls.push(input)
          if (input.type === 'get_tab') return { id: 't' }
          if (input.type === 'playwright_locator_count') return { count: 3 }
          return {}
        },
        async display() {}
      }
    })
    const tab = await browser.tabs.get('t')
    const count = await tab.playwright.getByRole('button').count()
    await tab.clipboard.writeText('hello')
    expect(count).toBe(3)
    return { count, calls }
  })
})
test('Tab registration boundary receives initial scope and constructs duplicate entries in order', async () => {
  const calls: unknown[] = [],
    first = { id: 'test', description: 'first' },
    last = { id: 'test', description: 'last' }
  const documentation = { get: async () => 'docs' }
  const tab = new ComposedTab({
    browserId: 'b',
    tabPayload: { id: 't' },
    transport,
    documentation,
    capabilities: [first, { id: 'unknown', description: 'skip' }, last],
    tabFactories: new Map([
      [
        'test',
        (options) => {
          calls.push(options)
          return { info: options.info }
        }
      ]
    ])
  })
  expect(calls).toEqual([
    { browserId: 'b', tabId: 't', transport, documentation, info: first },
    { browserId: 'b', tabId: 't', transport, documentation, info: last }
  ])
  expect(await tab.capabilities.list()).toEqual([last])
  expect((await tab.capabilities.get('test')).info).toBe(last)
})
test('candidate API factory filters composed Browser/Tab and executes candidate locator end to end', async () => {
  const { BrowserApiFactory } = await import('../src/api-factory')
  const { Agent, Browsers } = await import('../src/browser-agent')
  const { TabsControls } = await import('../src/tab-collections')
  const { PlaywrightAPI } = await import('../src/playwright')
  const { BaselineApiFactory } = await originalClient()
  async function exercise(candidate: boolean) {
    const calls: unknown[] = []
    const manifest = {
      interfaces: {
        Agent: {},
        Browsers: {},
        Browser: {},
        Tabs: {},
        Tab: { close: {} },
        PlaywrightAPI: {}
      }
    }
    const options = { apiManifest: manifest, disabledMemberIds: new Set(['Tab.close']) }
    const factory = candidate
      ? new BrowserApiFactory({
          ...options,
          runtimeTypes: {
            Agent,
            Browsers,
            Browser: ComposedBrowser,
            Tabs: TabsControls,
            Tab: ComposedTab,
            PlaywrightAPI
          },
          tabType: ComposedTab,
          createBrowser: (input) =>
            new ComposedBrowser({
              ...input,
              capabilities: undefined,
              browserFactories: new Map(),
              tabFactories: new Map()
            })
        })
      : new BaselineApiFactory(options)
    const agent = factory.createAgent({
      executeAgentCommand: async (input: any) => {
        calls.push(input)
        if (input.type === 'get_browser') return { id: 'b', name: 'browser', type: 'iab' }
        if (input.type === 'get_tab') return { id: 't' }
        if (input.type === 'playwright_locator_count') return { count: 2 }
        return {}
      }
    })
    const tab = await (await agent.browsers.get('b')).tabs.get('t')
    const count = await tab.playwright.getByRole('button').count()
    expect(count).toBe(2)
    return { hidden: tab.close, has: 'close' in tab, count, calls }
  }
  expect(await exercise(true)).toEqual(await exercise(false))
})
