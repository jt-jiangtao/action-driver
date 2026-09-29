// @vitest-environment node
import { test, expect } from 'vitest'
import { createLegacyCUAFacade } from '../../src/legacy-facade'
import { originalLegacyFacade } from '../original-legacy-facade'
async function compare(run: (create: any) => Promise<unknown>) {
  const expected = await run(originalLegacyFacade)
  expect(
    await run((setup: any, computer: any) =>
      createLegacyCUAFacade({ setupBrowser: setup, computer })
    )
  ).toEqual(expected)
}
function agent(id = 'b') {
  return {
    browsers: {
      async list() {
        return [{ id }]
      },
      async get() {
        return {
          tabs: {
            async list() {
              return [{ id: 't' }]
            }
          }
        }
      }
    },
    documentation: { id }
  }
}
function computer() {
  return {
    target: 'mac',
    async list_apps() {
      return [{ id: 'app' }]
    }
  }
}
test('legacy facade begins with null backends and initializes references, setup options and combined state', async () => {
  await compare(async (create) => {
    const calls: unknown[] = [],
      backend = computer(),
      browser = agent()
    const facade = await create(async (options: unknown) => {
      calls.push(options)
      return browser
    }, backend)
    const before = {
      keys: Object.keys(facade),
      computer: facade.computer,
      browsers: facade.browsers,
      docs: facade.documentation
    }
    const state = await facade.initialize()
    return {
      before,
      state,
      calls,
      same: [
        facade.computer === backend,
        facade.browsers === browser.browsers,
        facade.documentation === browser.documentation
      ]
    }
  })
})
test('legacy repeated initialization refreshes browser references without caching setup', async () => {
  await compare(async (create) => {
    const agents = [agent('first'), agent('second')],
      calls: unknown[] = []
    const facade = await create(async () => {
      const next = agents.shift()
      calls.push(next?.documentation.id)
      return next
    }, computer())
    const first = await facade.initialize(),
      second = await facade.initialize()
    return { first, second, calls, docs: facade.documentation.id }
  })
})
test('setup rejection keeps the last successful public references and preserves error identity', async () => {
  await compare(async (create) => {
    const failure = new Error('setup failed'),
      browser = agent(),
      backend = computer()
    let reject = false
    const facade = await create(async () => {
      if (reject) throw failure
      return browser
    }, backend)
    await facade.initialize()
    reject = true
    try {
      await facade.initialize()
    } catch (error) {
      return {
        sameError: error === failure,
        retained: [
          facade.computer === backend,
          facade.browsers === browser.browsers,
          facade.documentation === browser.documentation
        ]
      }
    }
  })
})
test('state failures remain partial results after successful public binding', async () => {
  await compare(async (create) => {
    const backend = {
      target: 'mac',
      async list_apps() {
        throw Error('apps unavailable')
      }
    }
    const browser = {
      browsers: {
        async list() {
          throw Error('browser unavailable')
        }
      },
      documentation: {}
    }
    const facade = await create(async () => browser, backend)
    const result = await facade.initialize()
    return { result, bound: facade.computer === backend && facade.browsers === browser.browsers }
  })
})
test('detached initialize closes over its facade rather than the call receiver', async () => {
  await compare(async (create) => {
    const browser = agent(),
      facade = await create(async () => browser, computer())
    const method = facade.initialize,
      receiver = { computer: 'other' }
    return {
      result: await method.call(receiver),
      receiver,
      bound: facade.browsers === browser.browsers
    }
  })
})
test('documentation accessor failure exposes the original sequential partial binding', async () => {
  await compare(async (create) => {
    const events: string[] = [],
      backend = computer(),
      browsers = agent().browsers
    const facade = await create(
      async () => ({
        get browsers() {
          events.push('browsers')
          return browsers
        },
        get documentation() {
          events.push('documentation')
          throw Error('getter failed')
        }
      }),
      backend
    )
    try {
      await facade.initialize()
    } catch (error) {
      return {
        events,
        message: (error as Error).message,
        sameComputer: facade.computer === backend,
        sameBrowsers: facade.browsers === browsers,
        docs: facade.documentation
      }
    }
  })
})
test('parallel setup completion determines final binding while each call returns its own state', async () => {
  await compare(async (create) => {
    const resolves: Array<(value: unknown) => void> = []
    const facade = await create(() => new Promise((resolve) => resolves.push(resolve)), computer())
    const first = facade.initialize(),
      second = facade.initialize()
    const a = agent('first'),
      b = agent('second')
    resolves[1]!(b)
    const secondResult = await second
    resolves[0]!(a)
    const firstResult = await first
    return { firstResult, secondResult, finalDocs: facade.documentation.id }
  })
})
test('initialize reads browser provider again for state after binding public fields', async () => {
  await compare(async (create) => {
    const first = agent('bound'),
      second = agent('state'),
      events: string[] = []
    let reads = 0
    const browser = {
      get browsers() {
        events.push('browsers')
        return ++reads === 1 ? first.browsers : second.browsers
      },
      get documentation() {
        events.push('documentation')
        return first.documentation
      }
    }
    const facade = await create(async () => browser, computer())
    const result = await facade.initialize()
    return { result, events, boundFirst: facade.browsers === first.browsers }
  })
})
test('caller changes to public slots do not replace captured initialization dependencies', async () => {
  await compare(async (create) => {
    const backend = computer(),
      browser = agent()
    const facade = await create(async () => browser, backend)
    facade.computer = {
      target: 'mac',
      async list_apps() {
        return [{ id: 'other' }]
      }
    }
    facade.browsers = null
    facade.documentation = 'changed'
    return {
      result: await facade.initialize(),
      sameComputer: facade.computer === backend,
      docs: facade.documentation.id
    }
  })
})
