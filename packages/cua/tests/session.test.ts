// @vitest-environment node
import { test, expect } from 'vitest'
import * as candidate from '../src/session'
import { originalCombinedSession } from './original-computer-session'
async function compare(run: (create: any) => Promise<unknown>) {
  const expected = await run(originalCombinedSession)
  expect(
    await run((agent: any, computer: any, host: any) =>
      (candidate as any).createCUASession({ agent, computer, getHost: () => host })
    )
  ).toEqual(expected)
}
function fixture() {
  const calls: any[] = [],
    output: any[] = []
  const browser = {
    browserId: 'b',
    async documentation() {
      calls.push(['browser.docs'])
      return 'browser docs'
    },
    tabs: {
      async list() {
        calls.push(['tabs.list'])
        return [{ id: 't', url: 'https://example.test/' }]
      }
    }
  }
  const agent = {
    browsers: {
      async list() {
        calls.push(['browsers.list'])
        return [{ id: 'b', type: 'iab' }]
      },
      async get(id: string) {
        calls.push(['browsers.get', id])
        return browser
      },
      async getDefault() {
        calls.push(['browsers.default'])
        return browser
      }
    }
  }
  const computer = {
    target: 'mac',
    async list_apps() {
      calls.push(['apps'])
      return [{ id: 'app' }]
    },
    async get_app_state(input: any) {
      calls.push(['app.state', input])
      return { app: 'canonical', text: 'app state', screenshot: null }
    }
  }
  const host = {
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' },
    requestMeta: {},
    async write(text: string, id: string) {
      output.push({ text, id })
    }
  }
  return { browser, agent, computer, host, calls, output }
}
function clean() {
  Reflect.deleteProperty(globalThis, 'agent')
  Reflect.deleteProperty(globalThis, 'nodeRepl')
}
test('combined session initializes documentation once and retains original public member order', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.computer, f.host)
      await session.getBrowser({ id: 'b' })
      await session.getApp('app')
      return {
        keys: Reflect.ownKeys(session),
        output: f.output,
        calls: f.calls,
        same: [session.computer === f.computer, session.browsers === f.agent.browsers]
      }
    } finally {
      clean()
    }
  })
})
test('combined state aggregates both surfaces with shared output and emit false behavior', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.computer, f.host)
      const emitted = await session.getState()
      const silent = await session.getState({ emit: false })
      const apps = await session.listApps({ emit: false })
      return { emitted, silent, apps, calls: f.calls, output: f.output }
    } finally {
      clean()
    }
  })
})
test('combined rewrite uses one core owner and retains browser documentation across computer actions', async () => {
  await compare(async (create) => {
    const f = fixture()
    try {
      const session = await create(f.agent, f.computer, f.host)
      await session.getBrowser({ id: 'b' })
      await session.getApp('app')
      await session.rewriteDocumentation()
      f.host.requestMeta = {}
      await session.rewriteDocumentation()
      await session.rewriteDocumentation()
      return { calls: f.calls, output: f.output }
    } finally {
      clean()
    }
  })
})
test('pending browser documentation does not block computer observation before browser emission', async () => {
  await compare(async (create) => {
    const f = fixture()
    let release!: (text: string) => void, entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    f.browser.documentation = () => {
      f.calls.push(['browser.docs'])
      entered()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    try {
      const session = await create(f.agent, f.computer, f.host)
      const browser = session.getBrowser({ id: 'b' })
      await ready
      await session.getApp('app')
      release('browser docs')
      await browser
      return { calls: f.calls, output: f.output }
    } finally {
      clean()
    }
  })
})
test('failed browser emission leaves shared queue usable for computer actions and later retry', async () => {
  await compare(async (create) => {
    const f = fixture(),
      write = f.host.write
    let failed = false
    f.host.write = async (text, id) => {
      await write(text, id)
      if (id === 'cua.browser.b' && !failed) {
        failed = true
        throw new Error('browser write failed')
      }
    }
    try {
      const session = await create(f.agent, f.computer, f.host)
      let error
      try {
        await session.getBrowser({ id: 'b' })
      } catch (e) {
        error = (e as Error).message
      }
      await session.getApp('app')
      await session.getBrowser({ id: 'b' })
      return { error, calls: f.calls, output: f.output }
    } finally {
      clean()
    }
  })
})
test('computer discovery failure does not poison browser documentation or a later retry', async () => {
  await compare(async (create) => {
    const f = fixture(), listApps = f.computer.list_apps
    let fails = true
    f.computer.list_apps = async () => {
      if (fails) {
        fails = false
        f.calls.push(['apps.disconnected'])
        throw new Error('computer disconnected')
      }
      return listApps()
    }
    try {
      const session = await create(f.agent, f.computer, f.host)
      let error
      try {
        await session.listApps()
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
      const browser = await session.getBrowser({ id: 'b' })
      const apps = await session.listApps({ emit: false })
      return { error, browser: browser.browserId, apps, calls: f.calls, output: f.output }
    } finally {
      clean()
    }
  })
})
test('combined session supports single surfaces and no injected surfaces without duplicate documentation', async () => {
  await compare(async (create) => {
    const result = []
    for (const surfaces of ['browser', 'computer', 'none']) {
      const f = fixture()
      try {
        const session = await create(
          surfaces === 'browser' ? f.agent : undefined,
          surfaces === 'computer' ? f.computer : undefined,
          f.host
        )
        result.push({
          state: await session.getState({ emit: false }),
          keys: Reflect.ownKeys(session),
          calls: f.calls,
          output: f.output
        })
      } finally {
        clean()
      }
    }
    return result
  })
})
