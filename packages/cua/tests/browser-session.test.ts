// @vitest-environment node
import { expect, test, vi } from 'vitest'
import * as candidate from '../src/browser-session'
import { originalBrowserSession } from './original-computer-session'
async function compare(run: (create: any) => Promise<unknown>) {
  const expected = await run(originalBrowserSession)
  expect(
    await run((agent: any, host: any) =>
      (candidate as any).createBrowserSession({ agent, getHost: () => host })
    )
  ).toEqual(expected)
}
function fixture() {
  const calls: any[] = [],
    output: any[] = []
  const controlled: any[] = [{ id: 'controlled', title: 'Title', url: 'https://example.test/' }]
  const userTabs: any[] = [
    { id: 'user', providerTabId: 'provider', title: 'User', url: 'https://user.test/' }
  ]
  const tab = (id: string) => ({
    id,
    async goto(url: string) {
      calls.push(['goto', id, url])
    },
    async getAXState(options: any) {
      calls.push(['state', id, options])
      return `state:${id}`
    }
  })
  const browser = {
    browserId: 'b',
    async documentation() {
      calls.push(['documentation'])
      return 'browser docs'
    },
    async nameSession(name: string) {
      calls.push(['nameSession', name])
    },
    capabilities: {
      async get(id: string) {
        calls.push(['capability', id])
        return {
          async set(value: boolean) {
            calls.push(['visibility', value])
          }
        }
      }
    },
    tabs: {
      async list() {
        calls.push(['tabs.list'])
        return controlled
      },
      async new() {
        calls.push(['tabs.new'])
        return tab('new')
      },
      async get(id: string) {
        calls.push(['tabs.get', id])
        return tab(id)
      }
    },
    user: {
      async openTabs() {
        calls.push(['user.openTabs'])
        return userTabs
      },
      async claimTab(value: any) {
        calls.push(['user.claimTab', value])
        return tab(value.id)
      }
    }
  }
  const listed: any[] = [
    { id: 'b', type: 'extension', metadata: { extensionInstanceId: 'profile' } }
  ]
  const browsers: any = {
    async list() {
      calls.push(['browsers.list'])
      return listed
    },
    async get(id: string) {
      calls.push(['browsers.get', id])
      return browser
    },
    async getDefault() {
      calls.push(['browsers.default'])
      return browser
    },
    async getForUrl(url: string) {
      calls.push(['browsers.url', url])
      return browser
    }
  }
  const host = {
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' },
    requestMeta: {},
    async write(text: string, id: string) {
      output.push({ text, id })
    }
  }
  return {
    agent: { browsers },
    browser,
    browsers,
    host,
    controlled,
    userTabs,
    listed,
    calls,
    output
  }
}
test('browser selection and tab creation preserve normalization, option order and documentation reuse', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.host)
      await session.getBrowser({ url: 'example.test' })
      await session.getBrowser({ extensionInstanceId: 'profile' })
      const created = await session.createBrowserTab('b', 'example.test', {
        sessionName: 'session',
        visible: true
      })
      return {
        calls: f.calls,
        output: f.output,
        id: created.id,
        sameAgent: (globalThis as any).agent === f.agent
      }
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('tab references prefer controlled matches and claim user tabs by id/provider id or absolute URL', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.host)
      const tabs = [
        await session.getTab('controlled', { browser: 'b' }),
        await session.getTab('provider', { browser: 'b' }),
        await session.getTab({ url: 'https://user.test/' }, { browser: 'b' })
      ]
      return { ids: tabs.map((tab) => tab.id), calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('browser and tab validation preserve errors without unintended actions', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.host),
        errors = []
      for (const action of [
        () => session.getBrowser({ id: 'b', extensionInstanceId: 'profile' }),
        () => session.getBrowser({ extensionInstanceId: 'missing' }),
        () => session.createBrowserTab(' '),
        () => session.getTab(''),
        () => session.getTab({ url: 'relative' }),
        () => session.getTab({ url: 'https://example.test/' }),
        () => session.getTab('missing', { browser: 'b' })
      ]) {
        try {
          await action()
        } catch (e) {
          errors.push((e as Error).message)
        }
      }
      return { calls: f.calls, output: f.output, errors }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('browser session lists/state merge user and controlled tabs and respect emit false', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.host)
      const values = [
        await session.listBrowsers({ emit: false }),
        await session.listTabs({ browser: 'b', emit: false }),
        await session.listTabs({ emit: false }),
        await session.getState({ emit: false })
      ]
      return { values, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('browser documentation failure evicts cache for retry and rewrite follows request metadata', async () => {
  await compare(async (create) => {
    const f = fixture()
    let fails = true
    f.browser.documentation = async () => {
      f.calls.push(['documentation'])
      if (fails) throw new Error('docs failed')
      return 'browser docs'
    }
    try {
      const session = await create(f.agent, f.host)
      let error
      try {
        await session.getBrowser({ id: 'b' })
      } catch (e) {
        error = (e as Error).message
      }
      fails = false
      await session.getBrowser({ id: 'b' })
      await session.rewriteDocumentation()
      f.host.requestMeta = {}
      await session.rewriteDocumentation()
      return { error, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})

test('tab mentions validate browser profile and stale titles while resolving provider IDs', async () => {
  await compare(async (create) => {
    const f = fixture()
    const mention = new URL('plugin://chrome@openai-bundled')
    for (const [key, value] of Object.entries({
      mention: 'tab-v1',
      browserId: 'profile',
      tabId: 'provider',
      title: 'User',
      url: 'https://user.test/'
    }))
      mention.searchParams.set(key, value)
    try {
      const session = await create(f.agent, f.host)
      const tab = await session.getTab({ mention: mention.href }, { browser: 'b' })
      f.userTabs[0].title = 'changed'
      let error
      try {
        await session.getTab({ mention: mention.href })
      } catch (e) {
        error = (e as Error).message
      }
      return { id: tab.id, error, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('provider ID fallback enriches controlled tabs from user metadata without claiming them', async () => {
  await compare(async (create) => {
    const f = fixture()
    f.userTabs.push({ id: 'controlled', providerTabId: 'controlled-provider', title: 'old' })
    try {
      const session = await create(f.agent, f.host)
      const tab = await session.getTab('controlled-provider', { browser: 'b' })
      return { id: tab.id, calls: f.calls, output: f.output, controlled: f.controlled }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('browser fallback selects first available entry and reports unavailable lists', async () => {
  await compare(async (create) => {
    const f = fixture()
    delete f.browsers.getForUrl
    delete f.browsers.getDefault
    try {
      const session = await create(f.agent, f.host)
      const browser = await session.getBrowser({ url: 'example.test' })
      f.listed.splice(0)
      let error
      try {
        await session.getBrowser()
      } catch (e) {
        error = (e as Error).message
      }
      return { id: browser.browserId, error, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('ambiguous references and missing claiming/session support preserve original errors', async () => {
  await compare(async (create) => {
    const f = fixture()
    f.controlled.push({ id: 'second', providerTabId: 'controlled', url: 'https://example.test/' })
    try {
      const session = await create(f.agent, f.host),
        errors = []
      try {
        await session.getTab('controlled', { browser: 'b' })
      } catch (e) {
        errors.push((e as Error).message)
      }
      Reflect.deleteProperty(f.browser.user, 'claimTab')
      try {
        await session.getTab('provider', { browser: 'b' })
      } catch (e) {
        errors.push((e as Error).message)
      }
      Reflect.deleteProperty(f.browser, 'nameSession')
      try {
        await session.createBrowserTab('b', undefined, { sessionName: 'session' })
      } catch (e) {
        errors.push((e as Error).message)
      }
      return { errors, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('parallel browser selection reuses documentation promise and serializes browser emissions', async () => {
  await compare(async (create) => {
    const f = fixture()
    let release!: (text: string) => void, entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    f.browser.documentation = () => {
      f.calls.push(['documentation'])
      entered()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    try {
      const session = await create(f.agent, f.host)
      const first = session.getBrowser({ id: 'b' }),
        second = session.getBrowser({ id: 'b' })
      await ready
      release('browser docs')
      await Promise.all([first, second])
      return { calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})

test('browser session retains original public member enumeration order', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      return Reflect.ownKeys(await create(f.agent, f.host))
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})

test('failed browser documentation output can retry without refetching successful documentation', async () => {
  await compare(async (create) => {
    const f = fixture()
    let failed = false
    const write = f.host.write
    f.host.write = async (text, id) => {
      await write(text, id)
      if (id === 'cua.browser.b' && !failed) {
        failed = true
        throw new Error('write failed')
      }
    }
    try {
      const session = await create(f.agent, f.host)
      let error
      try {
        await session.getBrowser({ id: 'b' })
      } catch (e) {
        error = (e as Error).message
      }
      await session.getBrowser({ id: 'b' })
      return { error, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
test('browser session defers documentation until a host writer becomes available', async () => {
  await compare(async (create) => {
    const f = fixture(),
      write = f.host.write
    Reflect.deleteProperty(f.host, 'write')
    try {
      const session = await create(f.agent, f.host)
      await session.getBrowser({ id: 'b' })
      const before = [...f.calls]
      f.host.write = write
      await session.getBrowser({ id: 'b' })
      return { before, calls: f.calls, output: f.output }
    } finally {
      Reflect.deleteProperty(globalThis, 'agent')
      Reflect.deleteProperty(globalThis, 'nodeRepl')
    }
  })
})
