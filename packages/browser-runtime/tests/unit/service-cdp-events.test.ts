// @vitest-environment node
import { test, expect } from 'vitest'
import { CdpEventState } from '../../src/service-cdp-events'
import { originalDocumentation } from '../original-service'
async function fixture(original: boolean) {
  const base = await originalDocumentation(),
    calls: any[] = [],
    api = {
      addEventListener: () => () => {},
      attach: async () => {},
      detach: async () => {},
      executeCdp: async (params: any) => {
        calls.push(params)
        return {}
      },
      executeCdpWithCachedExpression: async () => ({})
    },
    span = {
      currentCommandAttrs: () => ({}),
      withSpan: async (_n: any, _a: any, run: any) => run()
    },
    cdp = original ? new base.BaselineCdp(api, 'darwin', span) : new CdpEventState(api, span)
  if (original) {
    cdp.tabAttachHandlers.clear()
    cdp.tabCleanupHandlers.clear()
  }
  cdp.attachedTabIds.add(1)
  return { cdp, calls }
}
test('raw events preserve sequence, method/target filtering, cursor and eviction', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    for (let i = 0; i < 1005; i++)
      f.cdp.recordRawCdpEvent(1, {
        source: i % 2 ? { tabId: 1, sessionId: 'nested' } : { tabId: 1 },
        method: i % 2 ? 'Network.requestWillBeSent' : 'Page.loadEventFired',
        params: { index: i }
      })
    const results = [
      f.cdp.rawCdpEventsResult(1, 0, { limit: 2 }),
      f.cdp.rawCdpEventsResult(1, 1000, { methods: ['Page.loadEventFired'] }),
      f.cdp.rawCdpEventsResult(1, 1000, { target: { sessionId: 'nested' } })
    ]
    f.cdp.discardRawCdpEventsForTab(1)
    results.push(f.cdp.rawCdpEventsResult(1, 0, {}))
    return results
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('raw event long poll cleans listeners on matching event or tab detach', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      pending = f.cdp.readRawCdpEvents(1, {
        afterSequence: 0,
        timeoutMs: 100,
        methods: ['Page.loadEventFired']
      })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    f.cdp.recordRawCdpEvent(1, { source: { tabId: 1 }, method: 'Page.loadEventFired' })
    f.cdp.emit('event', { source: { tabId: 1 }, method: 'Page.loadEventFired' })
    const first = await pending,
      second = f.cdp.readRawCdpEvents(1, { afterSequence: 1, timeoutMs: 100 })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    f.cdp.emit('tabDetached', 1)
    const completed = await second
    if (!original) expect(f.cdp.listenerCount('event')).toBe(0)
    return { first, second: completed }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('dialog state exposes safe ids/type, validates prompt and blocks other methods', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      results: any[] = []
    for (const type of ['alert', 'prompt', 'unknown']) {
      f.cdp.rememberJsDialog({
        source: { tabId: 1 },
        params: { type, message: 'Message', defaultPrompt: 'default' }
      })
      results.push(f.cdp.getJsDialog(1))
      try {
        f.cdp.updateJsDialogPrompt(1, String(type === 'alert' ? 1 : 2), 'value')
        results.push('updated')
      } catch (e: any) {
        results.push(e.message)
      }
    }
    try {
      f.cdp.throwIfJsDialogBlocksMethod(1, 'Page.enable')
    } catch (e: any) {
      results.push(e.message)
    }
    f.cdp.deleteJsDialog(1, '2')
    results.push(f.cdp.getJsDialog(1))
    return results
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('credential-protected dialogs are dismissed automatically without retaining sensitive message', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    f.cdp.protectBrowserAuthCredentialDiagnostics(1)
    for (const type of ['alert', 'prompt'])
      f.cdp.handleJavaScriptDialogEvent({
        source: { tabId: 1 },
        method: 'Page.javascriptDialogOpening',
        params: { type, message: 'secret' }
      })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    return { dialog: f.cdp.getJsDialog(1), calls: f.calls }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('nested raw targets resolve ownership and reject ambiguous or untracked targets', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    f.cdp.handleAttachedToTarget({
      source: { tabId: 1 },
      params: { sessionId: 'session', targetInfo: { type: 'iframe', targetId: 'target' } }
    })
    const results: any[] = []
    for (const target of [
      {},
      { sessionId: 'session' },
      { targetId: 'target' },
      { sessionId: 'session', targetId: 'target' },
      { sessionId: 'missing' }
    ])
      try {
        results.push(f.cdp.rawCdpTarget(1, target))
      } catch (e: any) {
        results.push(e.message)
      }
    return results
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('internal screencasts retire session ids and serialize ownership independently by tab', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      results: any[] = []
    await f.cdp.withInternalScreencast(1, async (matches: any) => {
      const event = {
        source: { tabId: 1 },
        method: 'Page.screencastFrame',
        params: { sessionId: 9 }
      }
      results.push(f.cdp.isInternalScreencastEvent(1, event), matches(event))
      results.push(
        f.cdp.isInternalScreencastEvent(1, { ...event, source: { tabId: 1, sessionId: 'nested' } })
      )
    })
    results.push(
      f.cdp.isInternalScreencastEvent(1, {
        source: { tabId: 1 },
        method: 'Page.screencastFrame',
        params: { sessionId: 9 }
      })
    )
    return {
      results,
      active: f.cdp.activeInternalScreencastsByTabId.size,
      queues: f.cdp.screencastQueuesByTabId.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
