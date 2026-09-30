// @vitest-environment node
import { test, expect } from 'vitest'
import * as candidate from '../../src/runtime-factory'
import { originalConfiguredSession } from '../original-computer-session'
async function compare(run: (make: any) => Promise<unknown>) {
  const expected = await run(originalConfiguredSession)
  expect(
    await run((setupBrowser: any, computer: any, host: any, options: any) =>
      (candidate as any).createConfiguredCUASession(options, {
        loadBrowserSetup: async () => setupBrowser,
        loadComputer: async () => computer,
        getHost: () => host,
        platform: 'darwin'
      })
    )
  ).toEqual(expected)
}
function fixture() {
  const calls: any[] = [],
    output: any[] = []
  const agent = {
    browsers: {
      async list() {
        return []
      },
      async get() {
        throw new Error('not available')
      }
    }
  }
  const computer = {
    target: 'mac',
    async list_apps() {
      return [{ id: 'app' }]
    }
  }
  const host: any = {
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' },
    requestMeta: {},
    async write(text: string, id: string) {
      output.push({ text, id })
    }
  }
  const setupBrowser = async (options: any) => {
    calls.push({ ...options, decorateTab: typeof options.decorateTab })
    return agent
  }
  return { calls, output, agent, computer, host, setupBrowser }
}
function clean() {
  Reflect.deleteProperty(globalThis, 'agent')
  Reflect.deleteProperty(globalThis, 'nodeRepl')
}
test('configured runtime forwards browser environment, hidden AX member and documentation exclusions', async () => {
  await compare(async (make) => {
    const results = []
    for (const environment of [undefined, 'codex-app', 'training', 'cloud', 'orbit']) {
      const f = fixture()
      if (environment !== undefined) f.host.env.CUA_REPL_BROWSER_ENV = environment
      try {
        const session = await make(f.setupBrowser, f.computer, f.host, {})
        results.push({
          calls: f.calls,
          output: f.output,
          keys: Reflect.ownKeys(session),
          state: await session.getState({ emit: false })
        })
      } finally {
        clean()
      }
    }
    return results
  })
})

test('configured browser tab sends observations only to the injected Action-Driver host', async () => {
  const f = fixture()
  const privateWrites: unknown[] = []
  Reflect.set(globalThis, 'nodeRepl', { write: (...args: unknown[]) => privateWrites.push(args) })
  try {
    let observe: (() => Promise<string>) | undefined
    await candidate.createConfiguredCUASession({ browser: true, computer: false }, {
      loadBrowserSetup: async () => async (options) => {
        observe = options.decorateTab({ ax: {
          get: async () => 'state', paste: async () => undefined,
          click: async () => undefined, drag: async () => undefined,
          pressKey: async () => undefined, scroll: async () => undefined,
          selectText: async () => undefined, setValue: async () => undefined,
          typeText: async () => undefined, performSecondaryAction: async () => undefined
        } }).getAXState
        return f.agent
      },
      loadComputer: async () => f.computer,
      getHost: () => f.host
    })
    expect(await observe?.()).toBe('state')
    expect(f.output).toContainEqual({ text: 'state', id: 'cua.state' })
    expect(privateWrites).toEqual([])
  } finally {
    clean()
  }
})
test('core CUA documentation adds confirmation exclusions while disabled browser ignores invalid environment', async () => {
  await compare(async (make) => {
    const results = []
    for (const browser of [true, false]) {
      const f = fixture()
      f.host.env.TINYSKY_ALT_INITIALIZE_DOCS = 'core-cua-repl'
      if (!browser) f.host.env.CUA_REPL_BROWSER_ENV = 'invalid'
      try {
        const session = await make(f.setupBrowser, f.computer, f.host, { browser, computer: false })
        results.push({ calls: f.calls, output: f.output, keys: Reflect.ownKeys(session) })
      } finally {
        clean()
      }
    }
    return results
  })
})
test('invalid browser environment rejects before setup invocation and document output', async () => {
  await compare(async (make) => {
    const f = fixture()
    f.host.env.CUA_REPL_BROWSER_ENV = 'invalid'
    try {
      let error
      try {
        await make(f.setupBrowser, f.computer, f.host, {})
      } catch (e) {
        error = (e as Error).message
      }
      return { error, calls: f.calls, output: f.output }
    } finally {
      clean()
    }
  })
})
test('browser setup failure prevents shared documentation and global agent publication', async () => {
  await compare(async (make) => {
    const f = fixture(),
      previous = {}
    Reflect.set(globalThis, 'agent', previous)
    try {
      let error
      try {
        await make(
          async () => {
            throw new Error('browser initialization failed')
          },
          f.computer,
          f.host,
          {}
        )
      } catch (e) {
        error = (e as Error).message
      }
      return { error, output: f.output, previousRetained: (globalThis as any).agent === previous }
    } finally {
      clean()
    }
  })
})
test('disabled surfaces skip loaders and nonmac platform rejects before any backend loading', async () => {
  const calls: string[] = []
  const dependencies = {
    platform: 'darwin',
    getHost: () => undefined,
    loadBrowserSetup: async () => {
      calls.push('browser')
      throw new Error('should not load')
    },
    loadComputer: async () => {
      calls.push('computer')
      throw new Error('should not load')
    }
  }
  const session = await (candidate as any).createConfiguredCUASession(
    { browser: false, computer: false },
    dependencies
  )
  expect(await session.getState()).toEqual({ apps: [], browsers: [] })
  expect(calls).toEqual([])
  for (const platform of ['linux', 'win32']) {
    await expect(
      (candidate as any).createConfiguredCUASession({}, { ...dependencies, platform })
    ).rejects.toThrow('CUA runtime currently supports macOS only.')
  }
  expect(calls).toEqual([])
})

test('configured runtime waits for both backends before documentation or global publication', async () => {
  await compare(async (make) => {
    const f = fixture(),
      previous = {}
    let release!: (computer: any) => void, entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pendingComputer = new Promise((resolve) => {
      release = resolve
    })
    const setupBrowser = async (options: any) => {
      const agent = await f.setupBrowser(options)
      entered()
      return agent
    }
    Reflect.set(globalThis, 'agent', previous)
    try {
      const pending = make(setupBrowser, pendingComputer, f.host, {})
      await ready
      const before = { output: [...f.output], retained: (globalThis as any).agent === previous }
      release(f.computer)
      const session = await pending
      return {
        before,
        calls: f.calls,
        output: f.output,
        keys: Reflect.ownKeys(session),
        published: (globalThis as any).agent === f.agent
      }
    } finally {
      clean()
    }
  })
})
test('configuration starts both enabled loaders concurrently and rejects nonmac backend before publication', async () => {
  const f = fixture(),
    calls: string[] = [],
    previous = {}
  let loadBrowser!: (setup: any) => void, loadComputer!: (computer: any) => void
  Reflect.set(globalThis, 'agent', previous)
  try {
    const pending = (candidate as any).createConfiguredCUASession(
      {},
      {
        platform: 'darwin',
        getHost: () => f.host,
        loadBrowserSetup: () => {
          calls.push('browser')
          return new Promise((resolve) => {
            loadBrowser = resolve
          })
        },
        loadComputer: () => {
          calls.push('computer')
          return new Promise((resolve) => {
            loadComputer = resolve
          })
        }
      }
    )
    expect(calls).toEqual(['browser', 'computer'])
    loadBrowser(f.setupBrowser)
    loadComputer({ target: 'linux' })
    await expect(pending).rejects.toThrow('Computer sessions currently support macOS only.')
    expect(f.output).toEqual([])
    expect((globalThis as any).agent).toBe(previous)
  } finally {
    clean()
  }
})
