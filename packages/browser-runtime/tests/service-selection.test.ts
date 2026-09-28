// @vitest-environment node
import { test, expect } from 'vitest'
import {
  findBrowser,
  defaultBrowser,
  browserForUrl,
  TurnEndedTracker
} from '../src/service-context'
import { originalDocumentation } from './original-service'
const info = (id: string, type: string, urls: string[] = [], extra = {}) => ({
  id,
  info: { type, ...extra },
  api: {
    getTabs: async () => urls.map((url) => ({ url })),
    getUserTabs: async () => urls.map((url) => ({ url }))
  }
})
test('browser selection aliases, preferred extension and fallback match original', async () => {
  const base = await originalDocumentation(),
    items = [
      info('1', 'extension', [], {
        family: 'edge',
        metadata: { extensionInstanceId: 'preferred' }
      }),
      info('2', 'extension'),
      info('3', 'cdp'),
      info('arc', 'cdp'),
      info('opera-instance', 'extension', [], { family: 'opera' }),
      info('vivaldi-instance', 'extension', [], { family: 'vivaldi' })
    ],
    preference = { extensionInstanceId: 'preferred' }
  for (const id of [
    'opera',
    'vivaldi',
    'arc',
    'edge',
    'chrome',
    'extension',
    'cdp',
    'iab',
    '2',
    'missing',
    'toString'
  ])
    expect(findBrowser(items as any, id)?.id).toEqual(base.baselineFindBrowser(items, id)?.id)
  for (const list of [[], items, [...items, info('4', 'iab')], [items[2]]])
    expect(defaultBrowser(list as any, preference)?.id).toEqual(
      base.baselineDefaultBrowser(list, preference)?.id
    )
})
test.each([
  'https://example.com/path#other',
  'https://example.com/path?other',
  'https://example.com/other',
  'https://child.example.com',
  'https://unrelated.net',
  'file:///tmp/a',
  'http://localhost',
  'http://sub.localhost',
  'http://127.0.0.1',
  'http://[::1]'
])('URL selection %s matches original tiers', async (url) => {
  const base = await originalDocumentation(),
    items = [
      info('1', 'extension', ['https://example.com/path#hash'], {
        metadata: { extensionInstanceId: 'preferred' }
      }),
      info('2', 'iab', ['https://example.com/other']),
      info('3', 'extension', ['not a url', 'https://child.example.com'])
    ],
    preference = { extensionInstanceId: 'preferred' }
  expect((await browserForUrl(items as any, url, preference))?.id).toEqual(
    (await base.baselineBrowserForUrl(items, url, preference))?.id
  )
})
test('URL query failures are tolerated but malformed requested URLs reject even with one browser', async () => {
  const base = await originalDocumentation(),
    items = [info('1', 'iab'), info('2', 'extension')]
  items[0]!.api.getTabs = async () => {
    throw Error('tabs')
  }
  expect((await browserForUrl(items as any, 'https://example.com', null))?.id).toEqual(
    (await base.baselineBrowserForUrl(items, 'https://example.com', null))?.id
  )
  await expect(browserForUrl([items[0]] as any, 'invalid', null)).rejects.toThrow('Invalid URL')
})
test('turn tracker updates callbacks by session and turn, isolates cleanup failures and disposes once', async () => {
  const base = await originalDocumentation()
  async function exercise(Tracker: any) {
    let hook: any
    const calls: any[] = []
    const tracker = new Tracker({
      addTurnEndedHandler: (input: any) => {
        hook = input
        return () => calls.push('remove')
      }
    })
    const a = async (meta: any) => calls.push(['a', meta]),
      b = async () => {
        calls.push('b')
        throw Error('cleanup')
      }
    await tracker.track({ session_id: 's', turn_id: 'old' }, a)
    await tracker.track({ session_id: 's', turn_id: 'new' }, a)
    await tracker.track({ session_id: 's', turn_id: 'new' }, b)
    await tracker.track({ session_id: 'other', turn_id: 'new' }, a)
    await hook.run({ session_id: 's', turn_id: 'old' })
    await hook.run({ session_id: 's', turn_id: 'new' })
    await hook.run({ session_id: 's', turn_id: 'new' })
    tracker.dispose()
    tracker.dispose()
    await tracker.track({ session_id: 's', turn_id: 'new' }, a)
    await hook.run({ session_id: 's', turn_id: 'new' })
    return {
      calls,
      timeout: hook.timeoutMs,
      sessions: tracker.sessions.size,
      disposed: tracker.disposed
    }
  }
  expect(await exercise(TurnEndedTracker)).toEqual(await exercise(base.BaselineTurnTracker))
})
test('turn tracker requires trusted turn-ended hook', () => {
  expect(() => new TurnEndedTracker({} as any)).toThrow(
    'Browser Use requires Node REPL turn-ended hooks'
  )
})
