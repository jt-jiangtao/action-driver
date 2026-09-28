import { expect, test } from 'vitest'
import { cdpCommandHandlers, prepareRawCdp, rawCdpDestinationUrls } from '../src/service-cdp-commands'
import { originalDocumentation } from './original-service'

async function implementations() {
  const original = await originalDocumentation()
  return [cdpCommandHandlers, {
    tab_cdp_call: original.baselineCdpCallHandler,
    tab_cdp_events: original.baselineCdpEventsHandler
  }]
}
function fixture() {
  const calls: any[] = []
  const context = {
    preferences: { assertFullCdpEnabled: async () => { calls.push('preference') } },
    runtime: {}, clientInfo: { type: 'extension' },
    cdp: {
      hasBrowserAuthRawEventProtection: () => false,
      callRawCdp: async (...args: any[]) => { calls.push(['callRawCdp', ...args]); return { result: 42 } },
      readRawCdpEvents: async (...args: any[]) => { calls.push(['readRawCdpEvents', ...args]); return { cursor: 5, events: [], hasMore: false, truncated: false } }
    },
    documentResponses: {
      hasRequestInterceptors: () => false,
      hasOwnedPausedResponses: () => false,
      ensureInterceptionReady: async (id: number) => { calls.push(['interception', id]) }
    },
    security: {
      ensureFullCdpAllowed: async (id: number) => { calls.push(['approval', id]) },
      ensureRawCdpUrlAllowed: async (url: string) => { calls.push(['origin', url]) }
    }
  }
  return { context, calls }
}

test('allowed raw call validates and dispatches with preflight/interception callbacks', async () => {
  for (const handlers of await implementations()) {
    const { context, calls } = fixture()
    const result = await handlers.tab_cdp_call({ browser_id: 'b', tab_id: '7', method: 'Runtime.evaluate',
      params: { expression: '1 + 1' }, target: { session_id: 'child' }, timeout_ms: 50 }, context)
    expect(result).toEqual({ result: 42 })
    expect(calls.slice(0, 2)).toEqual(['preference', ['approval', 7]])
    const raw = calls.find(item => Array.isArray(item) && item[0] === 'callRawCdp')
    expect(raw.slice(1, 4)).toEqual([7, 'Runtime.evaluate', { expression: '1 + 1' }])
    expect(raw[4]).toMatchObject({ target: { sessionId: 'child' }, timeoutMs: 50 })
    await raw[4].prepareDispatch()
    expect(calls.at(-1)).toEqual(['interception', 7])
  }
})

test('raw call rejects blocked navigation before approval and authorizes destination URLs', async () => {
  for (const handlers of await implementations()) {
    const first = fixture()
    await expect(handlers.tab_cdp_call({ browser_id: 'b', tab_id: '7', method: 'Page.navigate',
      params: { url: 'https://blocked.test' } }, first.context)).rejects.toThrow('This method is not supported through raw CDP')
    expect(first.calls).toEqual(['preference'])
    const second = fixture()
    await handlers.tab_cdp_call({ browser_id: 'b', tab_id: '7', method: 'Network.getCookies',
      params: { urls: ['https://one.test', 'https://two.test'] } }, second.context)
    expect(second.calls.slice(0, 4)).toEqual(['preference', ['approval', 7], ['origin', 'https://one.test'], ['origin', 'https://two.test']])
  }
})

test('request interception and credential protection are rechecked before dispatch', async () => {
  for (const handlers of await implementations()) {
    const f = fixture()
    let protectedRequest = false
    f.context.documentResponses.hasRequestInterceptors = () => protectedRequest
    await handlers.tab_cdp_call({ browser_id: 'b', tab_id: '7', method: 'Network.enable' }, f.context)
    const raw = f.calls.find(item => Array.isArray(item) && item[0] === 'callRawCdp')
    protectedRequest = true
    expect(() => raw[4].beforeDispatch()).toThrow('Raw CDP is unavailable while Browser Use is protecting a browser request.')
  }
})

test('events validates filters then forwards source target and cursor options', async () => {
  for (const handlers of await implementations()) {
    const f = fixture()
    const result = await handlers.tab_cdp_events({ browser_id: 'b', tab_id: '7', after_sequence: 4,
      limit: 12, methods: ['Page.loadEventFired'], target: { target_id: 'child' }, timeout_ms: 0 }, f.context)
    expect(result).toEqual({ cursor: 5, events: [], hasMore: false, truncated: false })
    expect(f.calls).toEqual(['preference', ['approval', 7], ['readRawCdpEvents', 7, {
      afterSequence: 4, limit: 12, methods: ['Page.loadEventFired'], target: { sessionId: undefined, targetId: 'child' }, timeoutMs: 0
    }]])
    const invalid = fixture()
    await expect(handlers.tab_cdp_events({ browser_id: 'b', tab_id: '7', methods: [] }, invalid.context)).rejects.toThrow()
    expect(invalid.calls).toEqual(['preference'])
  }
})

test('raw method allowlist and Fetch Document interception match original policy', async () => {
  const original = await originalDocumentation()
  for (const [method, params, preserve] of [
    ['Runtime.evaluate', { expression: '1' }, true],
    ['Page.navigate', { url: 'https://x.test' }, true],
    ['Fetch.disable', undefined, true],
    ['Fetch.disable', undefined, false],
    ['Fetch.enable', { patterns: [{ resourceType: 'Script', requestStage: 'Request' }] }, true],
    ['Fetch.enable', { patterns: [{ resourceType: 'Document' }] }, true],
    ['Fetch.enable', { patterns: [{ resourceType: 'Document' }] }, false],
    ['Network.enable', { enableDurableMessages: true }, true],
    ['Network.getAllCookies', undefined, true],
    ['Input.dispatchKeyEvent', { type: 'keyDown' }, true],
    ['Page.getNavigationHistory', undefined, true],
    ['Unknown.command', undefined, true]
  ] as any[]) {
    const exercise = (fn: any) => {
      try { return { value: fn(method, params, { preserveDocumentInterception: preserve }) } }
      catch (error: any) { return { error: error.message } }
    }
    const ours = () => prepareRawCdp(method, params, preserve)
    const candidate = (() => { try { return { value: ours() } } catch (error: any) { return { error: error.message } } })()
    expect(candidate, method).toEqual(exercise(original.baselinePrepareRawCdp))
  }
})

test('raw CDP destination URLs and malformed input errors match original', async () => {
  const original = await originalDocumentation()
  for (const [method, params] of [
    ['Network.getCookies', { urls: ['https://a.test'] }],
    ['Network.getCookies', { urls: [] }],
    ['Network.getCookies', { urls: [42] }],
    ['Network.setCookie', { url: 'https://b.test', partitionKey: { topLevelSite: 'https://top.test' } }],
    ['Network.setCookie', { domain: '.test', url: 'https://b.test' }],
    ['Network.setCookies', { cookies: [{ url: 'https://a.test' }, { url: 'https://b.test' }] }],
    ['Fetch.continueResponse', { responseHeaders: [{ name: 'Location', value: 'https://c.test' }] }],
    ['Fetch.continueResponse', { responseHeaders: [{ name: 'Location', value: 9 }] }],
    ['Page.deleteCookie', { url: 'https://d.test' }],
    ['Page.navigate', { url: 'https://e.test' }]
  ] as any[]) {
    const exercise = (fn: any) => {
      try { return { value: fn(method, params) } }
      catch (error: any) { return { error: error.message } }
    }
    expect(exercise(rawCdpDestinationUrls), method).toEqual(exercise(original.baselineRawCdpUrls))
  }
})

test('credential and paused-response guards deny before approval', async () => {
  for (const handlers of await implementations()) {
    for (const blocked of ['credential', 'paused']) {
      const f = fixture()
      if (blocked === 'credential') f.context.cdp.hasBrowserAuthRawEventProtection = () => true
      else f.context.documentResponses.hasOwnedPausedResponses = () => true
      await expect(handlers.tab_cdp_call({ browser_id: 'b', tab_id: '7', method: 'Runtime.evaluate' }, f.context)).rejects.toThrow(
        blocked === 'credential' ? 'protecting credential saving' : 'resolving a paused document response'
      )
      expect(f.calls).toEqual(['preference'])
    }
  }
})

test('non-extension backend is rejected before payload parsing or raw CDP access', async () => {
  for (const handlers of await implementations()) {
    const f = fixture()
    f.context.clientInfo.type = 'native'
    await expect(handlers.tab_cdp_call({ invalid: true }, f.context)).rejects.toThrow('Full CDP access is currently only available')
    await expect(handlers.tab_cdp_events({ invalid: true }, f.context)).rejects.toThrow('Full CDP access is currently only available')
    expect(f.calls).toEqual(['preference', 'preference'])
  }
})
