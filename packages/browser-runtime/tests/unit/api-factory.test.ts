// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserApiFactory } from '../../src/api-factory'
import { originalClient } from '../original-client'
import { Agent, Browsers, Documentation } from '../../src/browser-agent'

async function factories(manifest: any, disabled = new Set<string>()) {
  const { baselineApi: types, BaselineApiFactory } = await originalClient()
  return {
    original: new BaselineApiFactory({ apiManifest: manifest, disabledMemberIds: disabled }),
    candidate: new BrowserApiFactory({
      apiManifest: manifest,
      disabledMemberIds: disabled,
      runtimeTypes: { ...types, Agent, Browsers, Documentation },
      createBrowser: (options: any) => new types.Browser(options),
      tabType: types.Tab
    }),
    types
  }
}
const transport = {
  async send() {
    return { items: [] }
  },
  async display() {}
}
test('factory browser support filtering matches original without changing the global disabled set', async () => {
  const manifest = {
    interfaces: {
      Browser: {
        history: { unsupportedByDefaultIn: ['extension'] },
        nameSession: {}
      }
    }
  }
  const disabled = new Set(['Browser.nameSession'])
  const { original, candidate } = await factories(manifest, disabled)
  for (const override of [undefined, { 'Browser.history': true }, { 'Browser.history': false }]) {
    function inspect(factory: any) {
      const browser = factory.createBrowser({
        browserInfo: { id: 'b', type: 'extension', apiSupportOverrides: override },
        transport
      })
      return {
        history: typeof browser.history,
        name: typeof browser.nameSession,
        id: browser.browserId,
        keys: Object.keys(browser)
      }
    }
    expect(inspect(candidate)).toEqual(inspect(original))
  }
  expect([...disabled]).toEqual(['Browser.nameSession'])
})
test('factory retains manifest and disabled references across later browser creation', async () => {
  const manifest = { interfaces: { Browser: { history: {} } } },
    disabled = new Set<string>()
  const { original, candidate } = await factories(manifest, disabled)
  expect(candidate.apiManifest).toBe(manifest)
  expect(candidate.disabledMemberIds).toBe(disabled)
  disabled.add('Browser.history')
  for (const factory of [original, candidate]) {
    expect(
      factory.createBrowser({ browserInfo: { id: 'b', type: 'iab' }, transport }).history
    ).toBeUndefined()
  }
})
test('factory agent dispatch, side effects and browser-used notification match original', async () => {
  const manifest = { interfaces: { Agent: {}, Browsers: {}, Documentation: {}, Browser: {} } }
  const { original, candidate } = await factories(manifest)
  async function exercise(factory: any) {
    const calls: any[] = [],
      events: string[] = []
    const agent = factory.createAgent({
      displaySideEffect: async (value: string) => {
        events.push(value)
      },
      executeAgentCommand: async (command: any) => {
        calls.push(command)
        if (command.type === 'get_browser')
          return { id: 'b', type: 'iab', name: 'browser', side_effects: ['visible'] }
        if (command.type === 'get_documentation') return 'documentation'
        return 'browser docs'
      }
    })
    const doc = await agent.documentation.get('core')
    const browser = await agent.browsers.get('b')
    const browserDoc = await browser.documentation()
    return {
      doc,
      browserDoc,
      id: browser.browserId,
      calls,
      events,
      sameMethod: agent.browsers.get === agent.browsers.get
    }
  }
  expect(await exercise(candidate)).toEqual(await exercise(original))
})
test('factory wrapAgent filters members and binds methods to their source instance', async () => {
  const manifest = { interfaces: { Agent: {}, Browsers: {}, Documentation: { get: {} } } }
  const { original, candidate, types } = await factories(manifest, new Set(['Documentation.get']))
  function inspect(factory: any, AgentType: any) {
    const source = new AgentType({ createBrowser: () => ({}), transport })
    const view = factory.wrapAgent(source)
    return {
      hidden: view.documentation.get,
      has: 'get' in view.documentation,
      same: view.browsers.list === view.browsers.list,
      wrapped: view !== source
    }
  }
  expect(inspect(candidate, Agent)).toEqual(inspect(original, types.Agent))
})
test('factory rejects unknown manifest runtime interfaces with the original message', async () => {
  const { BaselineApiFactory } = await originalClient()
  const options = {
    apiManifest: { interfaces: { Unknown: {} } },
    disabledMemberIds: new Set<string>()
  }
  expect(() => new BaselineApiFactory(options)).toThrow(
    'Browser API interface has no runtime type: Unknown'
  )
  expect(
    () => new BrowserApiFactory({ ...options, runtimeTypes: {}, createBrowser: () => ({}) })
  ).toThrow('Browser API interface has no runtime type: Unknown')
})
test('factory decorates returned tabs once and preserves lazy browser-used callback', async () => {
  const { baselineApi: types, BaselineApiFactory } = await originalClient()
  async function exercise(candidate: boolean) {
    const events: string[] = []
    const options = {
      apiManifest: { interfaces: { Browser: {}, Tabs: {}, Tab: {} } },
      disabledMemberIds: new Set<string>(),
      decorateTab: (tab: any) => {
        events.push(`decorate:${tab.id}`)
        tab.marker = true
      }
    }
    const factory = candidate
      ? new BrowserApiFactory({
          ...options,
          runtimeTypes: types,
          tabType: types.Tab,
          createBrowser: (input: any) => new types.Browser(input)
        })
      : new BaselineApiFactory(options)
    const browser = factory.createBrowser({
      browserInfo: { id: 'b', type: 'iab' },
      onBrowserUsed: () => events.push('used'),
      transport: {
        async send({ command }: any) {
          return command.toJSON().type === 'get_tab' ? { id: 't' } : 'docs'
        },
        async display() {}
      }
    })
    const tab = await browser.tabs.get('t')
    await browser.documentation()
    return { events, marker: tab.marker, id: tab.id, methodSame: tab.goto === tab.goto }
  }
  expect(await exercise(true)).toEqual(await exercise(false))
})
test('factory transport failures preserve error identity through agent and browser paths', async () => {
  const { original, candidate } = await factories({
    interfaces: { Agent: {}, Browsers: {}, Browser: {} }
  })
  const failure = new Error('service disconnected')
  for (const factory of [original, candidate]) {
    const agent = factory.createAgent({
      executeAgentCommand: async () => {
        throw failure
      }
    })
    await expect(agent.browsers.getDefault()).rejects.toBe(failure)
    const browser = factory.createBrowser({
      browserInfo: { id: 'b', type: 'iab' },
      transport: {
        async send() {
          throw failure
        },
        async display() {}
      }
    })
    await expect(browser.documentation()).rejects.toBe(failure)
  }
})
test('trusted bootstrap assembles candidate factory, agent and browser controls end to end', async () => {
  const { initializeBrowserRuntime } = await import('../../src/runtime-initialization')
  const { BrowserControls } = await import('../../src/browser-controls')
  const { setupBrowserRuntime } = await originalClient()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'nodeRepl')
  async function exercise(candidate: boolean) {
    const calls: unknown[] = []
    Object.defineProperty(globalThis, 'nodeRepl', {
      configurable: true,
      value: {
        rpc: async (service: string, request: any) => {
          calls.push({ service, request })
          if (request.method === 'setup')
            return {
              apiManifest: {
                interfaces: { Agent: {}, Browsers: {}, Browser: {}, Documentation: {} }
              },
              disabledMemberIds: ['Browser.nameSession']
            }
          if (request.params.type === 'get_default_browser')
            return { id: 'b', name: 'browser', type: 'iab' }
          if (request.params.type === 'browser_user_history')
            return { items: [{ url: 'https://example.test', dateVisited: '2026-09-28' }] }
          return 'documentation'
        },
        emitImage: async () => {}
      }
    })
    const agent = candidate
      ? await initializeBrowserRuntime({ host: {
        setup: (params) => (globalThis as any).nodeRepl.rpc('browser', { method: 'setup', params }),
        execute: (params) => (globalThis as any).nodeRepl.rpc('browser', { method: 'execute', params }),
        displayImage: (bytes) => (globalThis as any).nodeRepl.emitImage(bytes),
        close: async () => {}
      } }, (options) =>
          new BrowserApiFactory({
            ...options,
            runtimeTypes: { Agent, Browsers, Browser: BrowserControls, Documentation },
            createBrowser: (input) => new BrowserControls(input)
          }).createAgent(options)
        )
      : await setupBrowserRuntime({})
    const browser = await agent.browsers.getDefault()
    return {
      id: browser.browserId,
      hidden: browser.nameSession,
      history: await browser.history(),
      calls
    }
  }
  try {
    expect(await exercise(true)).toEqual(await exercise(false))
  } finally {
    if (previous) Object.defineProperty(globalThis, 'nodeRepl', previous)
    else Reflect.deleteProperty(globalThis, 'nodeRepl')
  }
})
