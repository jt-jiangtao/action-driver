// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { BrowserBackend } from '../src/service-backend.js'
import { originalDocumentation } from './original-service.js'

class SessionApi extends EventEmitter {
  detachTurn: ((isCurrent: () => boolean) => Promise<unknown>) | undefined
  closed = 0
  historyRequests: unknown[] = []
  namedSessions: unknown[] = []
  followed: unknown[] = []
  addEventListener(name: string, listener: (...args: any[]) => void) {
    this.on(name, listener)
  }
  addCloseListener(listener: () => void) {
    this.on('close', listener)
    return () => this.off('close', listener)
  }
  getCurrentSessionId() { return 'session-1' }
  getCurrentTurnId() { return 'turn-1' }
  getUserHistory(input: unknown) { this.historyRequests.push(input); return Promise.resolve(['entry']) }
  nameSession(input: unknown) { this.namedSessions.push(input); return Promise.resolve() }
  followSessionTab(...args: unknown[]) { this.followed.push(args); return Promise.resolve(true) }
  getInfo() { return Promise.resolve({ capabilities: { tab: [{ id: 'ax' }] } }) }
  executeUnhandledCommand(input: unknown) { return Promise.resolve({ echo: input }) }
  getTabs() { return Promise.resolve([]) }
  getUserTabs() { return Promise.resolve([]) }
  getCommittedTabUrl() { return Promise.resolve('https://example.test/') }
  executeCdp() { return Promise.resolve({}) }
  close() { this.closed++; return Promise.resolve() }
  attach() { return Promise.resolve() }
  detach() { return Promise.resolve() }
}

const options = {
  config: {} as any,
  runtime: { platform: 'darwin' as const, env: {} },
  commandTiming: { trackElicitation: (run: any) => run },
  filesystem: {} as any,
  environment: 'orbit',
  performanceSpan: { track: (_: unknown, run: () => unknown) => run() } as any,
  preferredWindowId: 4,
  elicitationDisplayName: 'Browser Use'
}

async function paired(type: 'iab' | 'extension' | 'cdp' = 'iab', overrides: Record<string, unknown> = {}, infoOverrides: Record<string, unknown> = {}) {
  const original = await originalDocumentation(),
    originalApi = new SessionApi(),
    candidateApi = new SessionApi(),
    info = { type, family: 'chrome', ...infoOverrides }
  return {
    original: new original.BaselineBackend(originalApi, 'browser-1', info, {
      ...options, ...overrides, runtime: { ...options.runtime, ...(overrides.runtime as object | undefined) }
    }),
    candidate: new BrowserBackend(candidateApi as any, 'browser-1', info, {
      ...options, ...overrides, runtime: { ...options.runtime, ...(overrides.runtime as object | undefined) }
    } as any),
    originalApi,
    candidateApi
  }
}

describe('per-browser service backend', () => {
  it('assembles real per-browser owners and delegates session methods like the baseline', async () => {
    const { original, candidate } = await paired()
    try {
      for (const backend of [original, candidate]) {
        expect(backend.browserId).toBe('browser-1')
        expect(backend.isIabBackend).toBe(true)
        expect(backend.cdp.platform).toBe('darwin')
        expect(backend.cua.scrollMethod).toBe('mouseWheel')
        expect(backend.tabs).toBeDefined()
        expect(backend.playwright).toBeDefined()
        expect(backend.security).toBeDefined()
        expect(backend.ax).toBeDefined()
        expect(await backend.history({ limit: 2 })).toEqual(['entry'])
        await backend.nameSession('new name')
        expect(backend.getCurrentSessionId()).toBe('session-1')
        expect(await backend.followSessionTab(9)).toBe(true)
        expect(await backend.supportsTabCapability('ax')).toBe(true)
        expect(await backend.supportsTabCapability('missing')).toBe(false)
        expect(await backend.executeUnhandledCommand({ type: 'extra' })).toEqual({ echo: { type: 'extra' } })
      }
    } finally { await Promise.all([original.dispose(), candidate.dispose()]) }
  })

  it('cleans page clipboard on turn detach and detaches CDP only when the turn remains current', async () => {
    const { original, candidate, originalApi, candidateApi } = await paired()
    try {
      for (const [backend, api] of [[original, originalApi], [candidate, candidateApi]] as const) {
        const calls: string[] = []
        backend.clipboard.cleanupPageClipboards = async () => { calls.push('clipboard') }
        backend.cdp.detachAllTabs = async () => { calls.push('cdp') }
        await api.detachTurn!(() => false)
        expect(calls).toEqual(['clipboard'])
        await api.detachTurn!(() => true)
        expect(calls).toEqual(['clipboard', 'clipboard', 'cdp'])
      }
    } finally { await Promise.all([original.dispose(), candidate.dispose()]) }
  })

  it('disposes once, unregisters close hooks and does not close a transport that already closed', async () => {
    for (const transportClosed of [false, true]) {
      const { original, candidate, originalApi, candidateApi } = await paired('extension')
      for (const [backend, api] of [[original, originalApi], [candidate, candidateApi]] as const) {
        if (transportClosed) api.emit('close')
        await Promise.all([backend.dispose(), backend.dispose()])
        expect(backend.transportClosed).toBe(transportClosed)
        expect(api.closed).toBe(transportClosed ? 0 : 1)
        expect(api.detachTurn).toBeUndefined()
        expect(api.listenerCount('close')).toBe(0)
      }
    }
  })

  it('captures site instructions from intercepted responses and clears them on frame load and detach', async () => {
    const { original, candidate } = await paired('cdp', {
      runtime: { gaas: {}, env: { HTTP_PROXY: 'http://proxy.test' } }
    })
    try {
      for (const backend of [original, candidate]) {
        const response = {
          frameId: 'frame-1',
          request: { url: 'https://example.test/a' },
          responseHeaders: [{ name: 'X-OpenAI-Site-Instruction', value: 'Use%20the%20menu' }]
        }
        backend.documentResponses.emit('response', 7, response)
        expect(backend.siteInstructions.peek(7, 'https://example.test/a')).toBe('Use the menu')
        expect(response.responseHeaders).toEqual([])
        backend.cdp.emit('event', { method: 'Page.frameStartedLoading', source: { tabId: 7 }, params: { frameId: 'frame-1' } })
        expect(backend.siteInstructions.peek(7, 'https://example.test/a')).toBeUndefined()
        backend.documentResponses.emit('response', 7, {
          frameId: 'frame-1', request: { url: 'https://example.test/a' },
          responseHeaders: [{ name: 'X-OpenAI-Site-Instruction', value: 'Again' }]
        })
        backend.documentResponses.emit('tabDetached', 7)
        expect(backend.siteInstructions.peek(7, 'https://example.test/a')).toBeUndefined()
      }
    } finally { await Promise.all([original.dispose(), candidate.dispose()]) }
  })

  it('returns false for follow-session outside orbit while retaining the same session API', async () => {
    const { original, candidate, originalApi, candidateApi } = await paired('extension', { environment: 'local' })
    try {
      expect(await original.followSessionTab(7)).toBe(false)
      expect(await candidate.followSessionTab(7)).toBe(false)
      expect(originalApi.followed).toEqual([])
      expect(candidateApi.followed).toEqual([])
    } finally { await Promise.all([original.dispose(), candidate.dispose()]) }
  })

  it('does not observe AX navigations when the runtime disables Tab.ax', async () => {
    const disabled = await paired(
      'extension',
      { runtime: { env: { BROWSER_USE_DISABLE_API_MEMBERS: 'Browser.other, Tab.ax' } } },
      { apiSupportOverrides: { 'Tab.ax': true } }
    )
    const enabled = await paired('extension', {}, { apiSupportOverrides: { 'Tab.ax': true } })
    try {
      const originalCount = (backend: any) => backend.cdp.listeners.event.length
      expect(originalCount(disabled.original)).toBeLessThan(originalCount(enabled.original))
      expect(
        enabled.candidate.cdp.listenerCount('event') - disabled.candidate.cdp.listenerCount('event')
      ).toBe(originalCount(enabled.original) - originalCount(disabled.original))
    } finally {
      await Promise.all([disabled.original.dispose(), disabled.candidate.dispose(), enabled.original.dispose(), enabled.candidate.dispose()])
    }
  })

  it('provides WebMCP and a visible-DOM producer sharing CUA node identity', async () => {
    const { candidate } = await paired()
    try {
      expect(candidate.webMcp).toBeDefined()
      expect(candidate.visibleDom.state).toBe(candidate.cua.domState)
      expect(candidate.screenshot).toBeDefined()
      expect(candidate.axInput).toBeDefined()
      expect(candidate.axClipboard).toBeDefined()
      expect(candidate.keyboard).toBeDefined()
    } finally { await candidate.dispose() }
  })

  it('AX ordinary key dispatch uses the same native CDP event sequence as the original action', async () => {
    const { original, candidate } = await paired()
    const base = await originalDocumentation()
    async function exercise(context: any, action: any) {
      const calls: unknown[] = []
      const originalCdp = context.cdp
      context.cdp = Object.assign(new EventEmitter(), {
        platform: 'darwin',
        getJsDialog: () => null,
        call: async (_id: number, method: string, params: unknown) => { calls.push([method, params]); return {} },
        callTarget: async (_target: unknown, method: string, params: unknown) => { calls.push([method, params]); return {} }
      })
      try {
        await action.perform(7, { kind: 'press_key', key: 'a' })
        return calls
      } finally { context.cdp = originalCdp }
    }
    try {
      expect(await exercise(candidate, new (await import('../src/service-ax-actions.js')).AxActions(candidate)))
        .toEqual(await exercise(original, new base.BaselineAxActions(original)))
    } finally { await Promise.all([original.dispose(), candidate.dispose()]) }
  })

  it('AX paste stores HTML and plain text in the virtual clipboard before page dispatch', async () => {
    const { candidate, original } = await paired(), base = await originalDocumentation()
    async function exercise(backend: any, action: any) {
      const cdp = backend.cdp, ensure = backend.clipboard.ensurePageClipboard
      const calls: Array<[string, unknown]> = []
      let installed = false
      backend.cdp = Object.assign(new EventEmitter(), {
        platform: 'darwin',
        getJsDialog: () => null,
        callTarget: async (_target: unknown, method: string, params: unknown) => {
          calls.push([method, params])
          return method === 'Runtime.evaluate' && calls.length === 1
            ? { result: {} }
            : { result: { value: { ok: true, data: {} } } }
        }
      })
      backend.clipboard.ensurePageClipboard = async () => { installed = true }
      try {
        await action.perform(7, { kind: 'paste', text: '<b>Hello</b>', format: 'html' })
        return { installed, clipboard: backend.clipboard.read(), methods: calls.map(([method]) => method) }
      } finally {
        backend.cdp = cdp
        backend.clipboard.ensurePageClipboard = ensure
      }
    }
    try {
      const actual = await exercise(candidate, new (await import('../src/service-ax-actions.js')).AxActions(candidate))
      const expected = await exercise(original, new base.BaselineAxActions(original))
      expect(actual).toEqual(expected)
      expect(actual.clipboard).toEqual([{
        entries: [
          { mime_type: 'text/html', text: '<b>Hello</b>' },
          { mime_type: 'text/plain', text: '<b>Hello</b>' }
        ]
      }])
    } finally { await Promise.all([original.dispose(), candidate.dispose()]) }
  })
})
