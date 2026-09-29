// @vitest-environment node
import { expect, test } from 'vitest'
import { Agent, Browsers, Documentation } from '../../src/browser-agent'
import { BrowserControls } from '../../src/browser-controls'
import { originalClient } from '../original-client'
async function compare(run: (api: any) => Promise<unknown>) {
  const { baselineApi } = await originalClient()
  expect(await run({ Agent, Browsers, Documentation, BrowserControls })).toEqual(
    await run({ ...baselineApi, BrowserControls: baselineApi.Browser })
  )
}
function fixture() {
  const calls: any[] = []
  const info = { id: 'b', name: 'Browser', type: 'iab', capabilities: {} }
  return {
    calls,
    info,
    transport: {
      async send(request: any) {
        const json = request.command.toJSON()
        calls.push(json)
        return json.type === 'get_documentation'
          ? 'docs'
          : json.type === 'list_browsers'
            ? [info]
            : info
      },
      async display() {}
    }
  }
}
test('browser selection preserves usage callbacks, factory context and result identity', async () => {
  await compare(async (api) => {
    const { calls, transport, info } = fixture(),
      usage: any[] = [],
      created: any[] = []
    const browsers = new api.Browsers({
      transport,
      onBrowserUsed: (value: any) => {
        usage.push(value.id)
      },
      createBrowser: (options: any) => {
        created.push({
          id: options.browserInfo.id,
          same: options.browserInfo === info,
          transport: options.transport === transport
        })
        options.onBrowserUsed()
        return { id: options.browserInfo.id }
      }
    })
    const values = [
      await browsers.list(),
      await browsers.get('b'),
      await browsers.getDefault(),
      await browsers.getForUrl('invalid-url-still-forwarded')
    ]
    return { values, calls, usage, created, keys: Reflect.ownKeys(browsers) }
  })
})
test('browser selection rejects missing id and propagates observer/factory errors', async () => {
  await compare(async (api) => {
    const { calls, transport } = fixture(),
      errors = []
    for (const config of [
      {},
      {
        onBrowserUsed() {
          throw new Error('observer failed')
        }
      },
      {
        createBrowser() {
          throw new Error('factory failed')
        }
      }
    ]) {
      const browsers = new api.Browsers({ transport, createBrowser: () => ({}), ...config })
      for (const id of ['', 'b']) {
        try {
          await browsers.get(id)
        } catch (e) {
          errors.push((e as Error).message)
        }
      }
    }
    return { calls, errors }
  })
})
test('Agent requires transport and wires browser selection plus documentation', async () => {
  await compare(async (api) => {
    const { calls, transport } = fixture()
    let error
    try {
      new api.Agent({})
    } catch (e) {
      error = (e as Error).message
    }
    const agent = new api.Agent({
      transport,
      createBrowser: ({ browserInfo }: any) => ({ id: browserInfo.id })
    })
    return {
      error,
      keys: Object.keys(agent),
      documentation: await agent.documentation.get('browser'),
      selected: await agent.browsers.getDefault(),
      calls
    }
  })
})
test('browser core normalizes history dates, queries and limits and trims session names', async () => {
  await compare(async (api) => {
    const calls: any[] = [],
      usage: any[] = []
    const transport = {
      async send(request: any) {
        calls.push(request.command.toJSON())
        return { items: ['entry'] }
      },
      async display() {}
    }
    const browser = new api.BrowserControls({
      browserId: 'b',
      transport,
      onBrowserUsed: () => usage.push('used')
    })
    const values = [
      await browser.documentation(),
      await browser.history(),
      await browser.history({
        queries: ['', 'q'],
        limit: 1,
        from: new Date('2026-01-01Z'),
        to: '2026-01-02Z'
      }),
      await browser.history({ queries: null, limit: null, from: null, to: null })
    ]
    await browser.nameSession('  work  ')
    return { values, calls, usage }
  })
})
test('browser history and session validate inputs before sending', async () => {
  await compare(async (api) => {
    const calls: any[] = []
    const transport = {
      async send(request: any) {
        calls.push(request.command.toJSON())
        return { items: [] }
      },
      async display() {}
    }
    const browser = new api.BrowserControls({ browserId: 'b', transport }),
      errors = []
    for (const options of [
      null,
      [],
      1,
      { queries: [] },
      { queries: [1] },
      { limit: 0 },
      { limit: 1.2 },
      { from: 'bad' },
      { to: 'bad' }
    ]) {
      try {
        await browser.history(options)
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    try {
      await browser.nameSession('   ')
    } catch (e) {
      errors.push((e as Error).message)
    }
    return { calls, errors }
  })
})
test('browser public id changes affect documentation/session while history keeps original id', async () => {
  await compare(async (api) => {
    const calls: any[] = []
    const transport = {
      async send(request: any) {
        calls.push(request.command.toJSON())
        return { items: [] }
      },
      async display() {}
    }
    const browser = new api.BrowserControls({ browserId: 'original', transport })
    browser.browserId = 'changed'
    await browser.documentation()
    await browser.history()
    await browser.nameSession('name')
    return calls
  })
})
test('Browser and Agent scope constructors do not execute unrelated getters', async () => {
  await compare(async (api) => {
    const { transport } = fixture()
    const options = { browserId: 'b', transport, createBrowser: () => ({}) }
    Object.defineProperty(options, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('unrelated getter')
      }
    })
    const browser = new api.BrowserControls(options),
      agent = new api.Agent(options),
      browsers = new api.Browsers(options)
    return {
      doc: await browser.documentation(),
      agentDoc: await agent.documentation.get('browser'),
      list: await browsers.list()
    }
  })
})

test('async browser factories resolve results and preserve rejection', async () => {
  await compare(async (api) => {
    const { transport, calls } = fixture()
    const browsers = new api.Browsers({ transport, createBrowser: async ({ browserInfo }: any) => ({ id: browserInfo.id }) })
    const values = [await browsers.get('b'), await browsers.getDefault(), await browsers.getForUrl('url')]
    let error
    try { await new api.Browsers({ transport, createBrowser: async () => { throw new Error('async factory failed') } }).getDefault() }
    catch (e) { error = (e as Error).message }
    return { values, calls, error }
  })
})
