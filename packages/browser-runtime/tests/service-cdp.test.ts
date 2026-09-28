// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserCdp } from '../src/service-cdp'
import { originalDocumentation } from './original-service'
async function fixture(original: boolean) {
  const base = await originalDocumentation(),
    calls: any[] = [],
    listeners = new Map<string, any>(),
    api = {
      addEventListener: (name: string, run: any) => listeners.set(name, run),
      attach: async (id: any) => calls.push(['attach', id]),
      detach: async (id: any) => calls.push(['detach', id]),
      executeCdp: async (params: any) => {
        calls.push(['cdp', params])
        return params.method === 'Target.getTargets'
          ? { targetInfos: [] }
          : params.method === 'Runtime.evaluate'
            ? { result: { value: { href: 'https://example.com', readyState: 'complete' } } }
            : {}
      },
      executeCdpWithCachedExpression: async () => ({}),
      browserAuthNewTargetProtection: async (params: any) => {
        calls.push(['protection', { ...params, leaseId: params.leaseId ? 'lease' : undefined }])
        return true
      }
    },
    span = {
      currentCommandAttrs: () => ({}),
      withSpan: async (_n: any, _a: any, run: any) => run()
    },
    cdp = original ? new base.BaselineCdp(api, 'darwin', span) : new BrowserCdp(api, 'darwin', span)
  return { cdp, calls, listeners }
}
test('concrete CDP attaches page/frame initialization and clears state on backend detach', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    await f.cdp.call(1, 'Page.getFrameTree')
    f.listeners.get('onCDPEvent')({
      source: { tabId: 1 },
      method: 'Page.frameNavigated',
      params: {
        frame: { id: 'main', url: 'https://example.com', securityOrigin: 'https://example.com' }
      }
    })
    const before = { url: f.cdp.currentTopLevelUrl(1), events: f.cdp.rawCdpEventsResult(1, 0, {}) }
    f.listeners.get('onCDPDetach')({ tabId: 1 })
    return {
      before,
      calls: f.calls,
      attached: f.cdp.isTabAttached(1),
      url: f.cdp.currentTopLevelUrl(1)
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('service-worker protection and bypass use nested leases and idempotent release', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      first = await f.cdp.protectServiceWorkerStarts(1),
      second = await f.cdp.protectServiceWorkerStarts(1)
    await first()
    await first()
    await second()
    const bypass = await f.cdp.protectBrowserAuthServiceWorkerBypass(1),
      other = await f.cdp.protectBrowserAuthServiceWorkerBypass(1)
    await bypass()
    await other()
    await other()
    return {
      calls: f.calls,
      protected: f.cdp.workerStartProtectionByTab.size,
      bypass: f.cdp.browserAuthWorkerBypassByTab.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('new-target credential protection acquires, verifies, closes and releases trusted backend lease', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      release = await f.cdp.protectBrowserAuthNewTargets(1),
      status = await f.cdp.browserAuthNewTargetCheck(1),
      closed = await f.cdp.closeBrowserAuthPausedTarget(1, 'target')
    await release()
    return { calls: f.calls, status, closed }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('raw CDP screencast ownership suppresses internal casts and document reads update current URL', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    await f.cdp.callRawCdp(1, 'Page.startScreencast', {})
    const internal = await f.cdp.withInternalScreencast(1, async () => 'internal')
    await f.cdp.callRawCdp(1, 'Page.stopScreencast', {})
    const document = await f.cdp.readDocumentState(1, { includePaint: true })
    await f.cdp.closeTab(1)
    return { calls: f.calls, internal, document, attached: f.cdp.isTabAttached(1) }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('event waits handle success, thrown predicates, timeout and cancellation with cleanup', async () => {
  for (const scenario of ['success', 'predicate', 'timeout', 'abort', 'initial']) {
    async function exercise(original: boolean) {
      const f = await fixture(original),
        controller = new AbortController()
      let result, error
      try {
        result = await f.cdp.waitForEvent(
          1,
          (event: any) => {
            if (scenario === 'predicate') throw 'bad predicate'
            return event.method === 'Page.loadEventFired'
          },
          {
            signal: controller.signal,
            timeoutMs: 5,
            timeoutMessage: 'timeout',
            initialCheck: scenario === 'initial' ? async () => true : undefined,
            action: async () => {
              if (scenario === 'abort') controller.abort()
              else if (scenario !== 'timeout' && scenario !== 'initial')
                f.cdp.emit('event', { source: { tabId: 1 }, method: 'Page.loadEventFired' })
            }
          }
        )
      } catch (e: any) {
        error = e.message
      }
      return { result, error }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('page-load classification handles same-document/load events and sanitized navigation blocks', async () => {
  for (const scenario of ['same', 'load', 'blocked', 'nothing']) {
    async function exercise(original: boolean) {
      const f = await fixture(original)
      f.cdp.mainFrameIdsByTabId.set(1, 'main')
      const wait = f.cdp.waitForPageLoadEvent(1, { classificationTimeoutMs: 5, timeoutMs: 5 })
      if (scenario === 'same')
        f.cdp.emit('event', {
          source: { tabId: 1 },
          method: 'Page.navigatedWithinDocument',
          params: { frameId: 'main' }
        })
      if (scenario === 'load') {
        f.cdp.emit('event', {
          source: { tabId: 1 },
          method: 'Page.frameStartedLoading',
          params: { frameId: 'main' }
        })
        f.cdp.emit('event', { source: { tabId: 1 }, method: 'Page.loadEventFired', params: {} })
      }
      if (scenario === 'blocked')
        f.cdp.emit('event', {
          source: { tabId: 1 },
          method: 'Page.navigationBlocked',
          params: {
            url: 'https://user:pass@example.com/path?secret=1#hash',
            resourceType: 'mainFrame'
          }
        })
      try {
        await wait
        return 'complete'
      } catch (e: any) {
        return { message: e.message, reason: e.reason }
      }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
