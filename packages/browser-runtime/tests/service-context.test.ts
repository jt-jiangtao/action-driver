// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserContext } from '../src/service-context'
import { originalDocumentation } from './original-service'
async function compare(exercise: (create: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  expect(
    await exercise(
      (host: any, preference: any, preferences: any, loader: any) =>
        new BrowserContext(host, preference, preferences, loader)
    )
  ).toEqual(await exercise(base.createBaselineContext))
}
function browser(id: string, type = 'extension') {
  const listeners: (() => void)[] = [],
    calls: string[] = []
  return {
    id,
    info: { type, metadata: { extensionInstanceId: id } },
    api: {
      getTabs: async () => [],
      getUserTabs: async () => [],
      addCloseListener: (callback: () => void) => {
        calls.push('listen')
        listeners.push(callback)
      },
      close: async () => {
        calls.push('close')
      }
    },
    listeners,
    calls
  }
}
test('context coalesces lazy refresh, tracks each API once and filters closed browser identity', async () => {
  await compare(async (create) => {
    const a = browser('1'),
      b = browser('2', 'iab'),
      calls: any[] = []
    const context = create(
      { addTurnEndedHandler: () => () => calls.push('remove') },
      { extensionInstanceId: '1', preferredWindowId: 8 },
      {},
      async (_host: any, _create: any, previous: any[]) => {
        calls.push(previous.map((item) => item.id))
        await Promise.resolve()
        return [a, b]
      }
    )
    const [first, second] = await Promise.all([context.list(), context.list()])
    expect(first).toBe(second)
    await context.refresh()
    a.listeners[0]!()
    const remaining = (await context.list()).map((item: any) => item.id)
    await context.dispose()
    return {
      calls,
      remaining,
      a: a.calls,
      b: b.calls,
      preferred: context.preferredWindowIdFor(a.info),
      other: context.preferredWindowIdFor(b.info),
      browsers: context.browsers,
      refresh: context.refreshPromise
    }
  })
})
test('context failed refresh retries and reports missing/default browsers identically', async () => {
  await compare(async (create) => {
    let count = 0
    const context = create({ addTurnEndedHandler: () => () => {} }, null, {}, async () => {
      if (++count === 1) throw Error('discover')
      return []
    })
    const errors: string[] = []
    for (const run of [
      () => context.list(),
      () => context.get('missing'),
      () => context.getDefault(),
      () => context.getForUrl('https://example.com')
    ])
      try {
        await run()
      } catch (error: any) {
        errors.push(error.message)
      }
    return { errors, count, refresh: context.refreshPromise }
  })
})
test('context disposal waits for discovery before closing its browsers', async () => {
  await compare(async (create) => {
    let resolve!: (value: any[]) => void
    const pending = new Promise<any[]>((yes) => (resolve = yes)),
      a = browser('1'),
      calls: string[] = []
    const context = create(
      { addTurnEndedHandler: () => () => calls.push('remove') },
      null,
      {},
      () => pending
    )
    const refresh = context.refresh(),
      disposing = context.dispose()
    resolve([a])
    await Promise.all([refresh, disposing])
    return { calls, browser: a.calls, browsers: context.browsers }
  })
})
