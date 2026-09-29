// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createCommandRegistry } from '../../src/service-command-registry'

test('auth registry dispatches safe preflight and refuses credential prompt without a submission adapter', async () => {
  const handler = createCommandRegistry().tab_browser_auth_handoff
  expect(typeof handler).toBe('function')
  const methods: string[] = []
  const backend = {
    api: { getInfo: async () => ({ name: 'Browser', capabilities: { tab: [{ id: 'browserAuth' }] } }) },
    clientInfo: { type: 'cdp' },
    cdp: { call: async (_id: number, method: string) => {
      methods.push(method)
      return { frameTree: { frame: {
        id: 'frame', loaderId: 'loader', securityOrigin: 'https://example.com',
        url: 'https://example.com/login', domainAndRegistry: 'example.com'
      } } }
    } },
    playwright: undefined,
    runtime: { env: {}, createElicitation: async () => { throw Error('must not prompt') } }
  }
  const params = {
    browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'username', label: 'Username', selector: '#username', type: 'text', required: true }]
  }
  expect(await handler(params, backend)).toEqual({ status: 'unavailable' })
  expect(methods).toEqual(['Page.getFrameTree'])
  expect(await handler({ ...params, fields: [...params.fields, { ...params.fields[0], id: 'other' }] }, backend))
    .toEqual({ status: 'locator_invalid' })
  expect(methods).toEqual(['Page.getFrameTree'])
})

test('auth registry uses native selector host to fill and submit ordinary broker credentials', async () => {
  const calls: string[] = []
  const playwright: any = {
    evaluateOnPlaywrightSelector: async (_tab: string, _selector: string, _page: Function, options: any) =>
      options.arg.operation === 'browser-auth-user-visibility' ? true : {
        accessible_name: 'Username', autocomplete: 'username', input_type: 'text',
        input_mode: null, input_name: 'username', required: true
      },
    evaluateOnPlaywrightSelectorAll: async () => 1,
    readElementState: async () => true,
    selectorsResolveToDistinctElements: async () => true,
    evaluateOnPlaywrightSelectorWithTarget: async (_tab: string, selector: string, _page: Function, options: any) => {
      if (options.arg?.operation === 'browser-auth-fill') {
        calls.push(`fill:${selector}:${options.arg.value}`)
        return { result: true }
      }
      return { frameIdentity: { frameId: 'frame', loaderId: 'loader',
        url: 'https://example.com/login', domainAndRegistry: 'example.com' },
      result: 'https://example.com/login', target: { tabId: 7 } }
    },
    withBoundPlaywrightSelector: async (_id: number, _selector: string, allowed: () => Promise<boolean>,
      run: (bound: unknown) => Promise<unknown>) => { if (await allowed()) await run(playwright) },
    clickLocator: async () => { calls.push('click:#submit') }
  }
  const backend: any = {
    api: { getInfo: async () => ({ name: 'Browser', capabilities: { tab: [{ id: 'browserAuth' }] } }) },
    clientInfo: { type: 'cdp' }, playwright,
    cdp: { call: async () => ({ frameTree: { frame: {
      id: 'frame', loaderId: 'loader', securityOrigin: 'https://example.com',
      url: 'https://example.com/login', domainAndRegistry: 'example.com'
    } } }) },
    runtime: { env: {}, createElicitation: async () => ({ action: 'accept' }),
      gaas: { getBrowserAuthBrokerChallenge: async () => ({
        id: 'a'.repeat(32), hasSubmission: true,
        waitForSubmission: async () => ({ fields: { username: 'alice' } }),
        complete: async (status: string) => status,
        close: () => {}
      }) } }
  }
  const result = await createCommandRegistry().tab_browser_auth_handoff({
    browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'username', label: 'Username', selector: '#username', type: 'text', required: true }],
    submit: { action: 'click', selector: '#submit' }
  }, backend)
  expect(result).toEqual({ status: 'submitted' })
  expect(calls).toEqual(['fill:#username:alice', 'click:#submit'])
})

test('ordinary manual-save delivery installs gate and document permit before filling', async () => {
  const events: string[] = []
  const playwright: any = {
    evaluateOnPlaywrightSelector: async (_tab: string, selector: string, _page: Function, options: any) =>
      options.arg.operation === 'browser-auth-user-visibility' ? true : {
        accessible_name: selector === '#password' ? 'Password' : 'Username',
        autocomplete: selector === '#password' ? 'current-password' : 'username',
        input_type: selector === '#password' ? 'password' : 'text',
        input_mode: null, input_name: selector.slice(1), required: true
      },
    evaluateOnPlaywrightSelectorAll: async () => 1,
    readElementState: async () => true,
    selectorsResolveToDistinctElements: async () => true,
    evaluateOnPlaywrightSelectorWithTarget: async (_tab: string, selector: string, _page: Function, options: any) => {
      if (options.arg?.operation === 'browser-auth-fill') {
        events.push(`fill:${selector}`)
        return { result: true }
      }
      return { frameIdentity: { frameId: 'frame', loaderId: 'loader',
        url: 'https://example.com/login', domainAndRegistry: 'example.com' },
      result: 'https://example.com/login', target: { tabId: 7 } }
    },
    withBoundPlaywrightSelector: async (_id: number, _selector: string, allowed: () => Promise<boolean>,
      run: (bound: unknown) => Promise<unknown>) => { if (await allowed()) await run(playwright) },
    clickLocator: async () => { events.push('submit') }
  }
  const cdp: any = {
    on: () => {}, removeListener: () => {},
    suppressRawNetworkEvents: () => { events.push('raw-protect'); return () => events.push('raw-release') },
    protectBrowserAuthServiceWorkerBypass: async () => async () => {},
    protectBrowserAuthCredentialDiagnostics: () => { events.push('diagnostics') },
    call: async (_id: number, method: string) => method === 'Page.getFrameTree'
      ? { frameTree: { frame: { id: 'frame', loaderId: 'loader',
        securityOrigin: 'https://example.com', url: 'https://example.com/login',
        domainAndRegistry: 'example.com' } } }
      : { root: { localName: 'html' } }
  }
  const gate: any = {
    epoch: 1,
    protectManualSaving: async (_id: number, release: () => void) => {
      events.push('gate-protect'); release(); gate.epoch++
    },
    allowOrdinaryInteraction: () => { events.push('gate-allow') }
  }
  const backend: any = {
    api: { getInfo: async () => ({ name: 'Browser', capabilities: { tab: [{ id: 'browserAuth' }] } }) },
    clientInfo: { type: 'cdp' }, playwright, cdp, credentialObservationGate: gate,
    documentResponses: { on: () => {}, removeListener: () => {},
      addRequestInterceptor: async () => { events.push('permit'); return async () => {} } },
    runtime: { env: { BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION: '10' },
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session-1' } },
      createElicitation: async () => ({ action: 'accept' }),
      gaas: { getBrowserAuthBrokerChallenge: async () => ({
        id: 'a'.repeat(32), hasSubmission: true,
        waitForSubmission: async () => ({ fields: { username: 'alice', password: 'secret' },
          manual_credential_save: true }),
        complete: async (status: string) => status, close: () => {}
      }) } }
  }
  const result = await createCommandRegistry().tab_browser_auth_handoff({
    browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'username', label: 'Username', selector: '#username', type: 'text', required: true },
      { id: 'password', label: 'Password', selector: '#password', type: 'password', required: true }],
    submit: { action: 'click', selector: '#submit' }
  }, backend, undefined, () => { events.push('release-command') })
  expect(result).toEqual({ status: 'submitted' })
  expect(events.indexOf('release-command')).toBeLessThan(events.indexOf('permit'))
  expect(events.indexOf('permit')).toBeLessThan(events.indexOf('fill:#username'))
  expect(events).toContain('gate-allow')
  expect(events).toContain('raw-release')
})

// The original reader caches its first initialization attempt, including failures.
test.each([true, false])('QR-only auth captures browser screenshot with WASM enabled=%s', async (useWasm) => {
  const published: string[] = []
  const png = useWasm ? await readFile(resolve('packages/browser-runtime/tests/fixtures/auth-qr.png')) : undefined
  const playwright: any = {
    evaluateOnPlaywrightPage: vi.fn(async () => ({ payload: 'https://example.com/signin',
      points: [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 11 }, { x: 1, y: 11 }] }))
  }
  const backend: any = {
    browserId: 'browser', clientInfo: { type: 'cdp' }, playwright,
    ...(useWasm ? { filesystem: { readBytes: async (url: URL) => await readFile(url) } } : {}),
    api: { getInfo: async () => ({ name: 'Browser', capabilities: { tab: [{ id: 'browserAuth' }] } }) },
    cdp: { call: async (_id: number, method: string) => method === 'Page.getFrameTree'
      ? { frameTree: { frame: { id: 'frame', loaderId: 'loader',
        securityOrigin: 'https://example.com', url: 'https://example.com/login' } } }
      : { data: png?.toString('base64') ?? 'YWJj' } },
    screenshot: async () => ({ data: png?.toString('base64') ?? 'YWJj' }),
    runtime: { env: {}, createElicitation: async () => ({ action: 'decline' }),
      gaas: { getBrowserAuthBrokerChallenge: async () => ({
        id: 'a'.repeat(32), hasSubmission: false,
        waitForSubmission: async () => ({ status: 'declined' }),
        publishQrCodePayload: (payload: string) => { published.push(payload) },
        complete: async (status: string) => status,
        close: () => {}
      }) } }
  }
  const result = await createCommandRegistry().tab_browser_auth_handoff({
    browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
    fields: [], qr_code: true
  }, backend)
  expect(result).toEqual({ status: 'declined' })
  expect(published).toContain('https://example.com/signin')
  const pageQrReads = playwright.evaluateOnPlaywrightPage.mock.calls.filter((call: any[]) =>
    typeof call[2]?.arg?.screenshotUrl === 'string')
  expect(pageQrReads).toHaveLength(useWasm ? 0 : 2)
})

test('private v8 delivery submits after HMAC permit with manual and mixed native flags', async () => {
  for (const mixedNative of [false, true]) {
  const events: string[] = []
  const cdpEvents = new EventEmitter()
  const requestEvents = new EventEmitter()
  let intercept: (request: any) => Promise<unknown> = async () => 'block'
  const requests = Object.assign(requestEvents, {
    addRequestInterceptor: async (_id: number, callback: typeof intercept) => {
      events.push('permit'); intercept = callback; return async () => {}
    }
  })
  const cdp: any = Object.assign(cdpEvents, {
    suppressRawNetworkEvents: () => () => {},
    protectBrowserAuthNewTargets: async () => async () => {},
    protectServiceWorkerStarts: async () => async () => {},
    protectBrowserAuthServiceWorkerBypass: async () => async () => {},
    protectBrowserAuthCredentialDiagnostics: () => {},
    browserAuthNewTargetCheck: async () => 'contained',
    call: async (_id: number, method: string) => method === 'Page.getFrameTree'
      ? { frameTree: { frame: { id: 'frame', loaderId: 'loader', securityOrigin: 'https://example.com',
        url: 'https://example.com/login', domainAndRegistry: 'example.com' } } }
      : method === 'Page.createIsolatedWorld' ? { executionContextId: 10 }
        : method === 'Runtime.evaluate' ? { result: { value: true } }
          : { root: { localName: 'html', children: [] } }
  })
  const playwright: any = {
    evaluateOnPlaywrightSelector: async (_tab: string, selector: string, _page: Function, options: any) => {
      if (options.arg?.operation === 'browser-auth-user-visibility') return true
      if (options.arg?.operation === 'browser-auth-field-label-metadata') return {
        accessible_name: selector === '#password' ? 'Password' : 'Username',
        autocomplete: selector === '#password' ? 'current-password' : 'username',
        input_type: selector === '#password' ? 'password' : 'text', input_mode: null,
        input_name: selector.slice(1), required: true
      }
      if (options.arg?.operation === 'browser-auth-submission-origin')
        return { origin: 'https://example.com', url: 'https://example.com/login' }
      if (options.arg?.values != null) {
        events.push('isolated-submit')
        const paused = { frameId: 'frame', resourceType: 'Document', requestId: 'f1', networkId: 'n1',
          request: { url: 'https://example.com/login', method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            postData: 'username=alice&password=secret' } }
        expect(await intercept(paused)).toBeUndefined()
        cdpEvents.emit('event', { source: { tabId: 7 }, method: 'Network.requestWillBeSent', params: {
          requestId: 'n1', loaderId: 'next', frameId: 'frame', type: 'Document',
          request: { url: 'https://example.com/login', method: 'POST' } } })
        cdpEvents.emit('event', { source: { tabId: 7 }, method: 'Network.responseReceived', params: {
          requestId: 'n1', loaderId: 'next', frameId: 'frame', type: 'Document',
          response: { url: 'https://example.com/login', status: 200 } } })
        requestEvents.emit('requestResolution', 7, paused, 'released')
        cdpEvents.emit('event', { source: { tabId: 7 }, method: 'Page.frameNavigated', params: {
          frame: { id: 'frame', loaderId: 'next', url: 'https://example.com/login' } } })
      }
      return true
    },
    evaluateOnPlaywrightSelectorAll: async () => 1,
    readElementState: async () => true,
    selectorsResolveToDistinctElements: async () => true,
    evaluateOnPlaywrightSelectorWithTarget: async () => ({ frameIdentity: {
      frameId: 'frame', loaderId: 'loader', url: 'https://example.com/login', domainAndRegistry: 'example.com' },
      result: 'https://example.com/login', target: { tabId: 7 } }),
    withBoundPlaywrightSelector: async (_id: string, _selector: string, allowed: () => Promise<boolean>,
      run: (bound: unknown) => Promise<void>) => { if (await allowed()) await run(playwright) }
  }
  const backend: any = {
    api: { getInfo: async () => ({ name: 'Browser', capabilities: { tab: [{ id: 'browserAuth' }] } }) },
    clientInfo: { type: 'cdp' }, playwright, cdp, documentResponses: requests,
    credentialObservationGate: { epoch: 1,
      protectManualSaving: async (_id: number, finish: () => void) => { events.push('gate'); finish() },
      protect: async (_id: number, finish: () => void) => { events.push('native-gate'); finish() } },
    runtime: { env: { BROWSER_AUTH_BROKER_MANUAL_SAVE_BINDING_VERSION: '8',
      ...(mixedNative ? { BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION: '1' } : {}) },
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session-1' } },
      createElicitation: async () => ({ action: 'accept' }),
      gaas: { getBrowserAuthBrokerChallenge: async () => ({
        id: 'a'.repeat(32), hasSubmission: true,
        waitForSubmission: async () => ({ fields: { username: 'alice', password: 'secret' },
          manual_credential_save: true, native_credential_delivery: mixedNative }),
        complete: async (status: string) => status, close: () => {}
      }) } }
  }
  expect(await createCommandRegistry().tab_browser_auth_handoff({
    browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'username', label: 'Username', selector: '#username', type: 'text', required: true },
      { id: 'password', label: 'Password', selector: '#password', type: 'password', required: true }],
    submit: { action: 'click', selector: '#submit' }
  }, backend, undefined, () => events.push('release-command'))).toEqual({ status: 'submitted' })
  expect(events).toEqual(mixedNative
    ? ['gate', 'release-command', 'native-gate', 'release-command', 'permit', 'isolated-submit']
    : ['gate', 'release-command', 'permit', 'isolated-submit'])
  }
})

test('native delivery protects observation before isolated-world form fill', async () => {
  const calls: string[] = []
  const playwright: any = {
    evaluateOnPlaywrightSelector: async (_tab: string, selector: string, _page: Function, options: any) => {
      if (options.arg?.operation === 'browser-auth-user-visibility') return true
      if (options.arg?.operation === 'browser-auth-submission-origin')
        return { origin: 'https://example.com', url: 'https://example.com/login' }
      if (options.arg?.operation === 'browser-auth-field-label-metadata') return {
        accessible_name: selector === '#password' ? 'Password' : 'Username',
        autocomplete: selector === '#password' ? 'current-password' : 'username',
        input_type: selector === '#password' ? 'password' : 'text',
        input_mode: null, input_name: selector.slice(1), required: true
      }
      calls.push(`submit-check:${options.isolatedWorld}`)
      return true
    },
    evaluateOnPlaywrightSelectorAll: async () => 1,
    readElementState: async () => true,
    selectorsResolveToDistinctElements: async () => true,
    evaluateOnPlaywrightSelectorWithTarget: async (_tab: string, selector: string, _page: Function, options: any) => {
      if (options.arg?.operation === 'browser-auth-fill') {
        calls.push(`fill:${selector}:${options.isolatedWorld}`)
        return { result: true }
      }
      return { frameIdentity: { frameId: 'frame', loaderId: 'loader',
        url: 'https://example.com/login', domainAndRegistry: 'example.com' },
        result: 'https://example.com/login', target: { tabId: 7 } }
    },
    withBoundPlaywrightSelector: async (_id: number, _selector: string, allowed: () => Promise<boolean>,
      run: (bound: unknown) => Promise<void>) => { if (await allowed()) await run(playwright) },
    clickLocator: async () => { calls.push('click') }
  }
  const backend: any = {
    api: { getInfo: async () => ({ name: 'Browser', capabilities: { tab: [{ id: 'browserAuth' }] } }) },
    clientInfo: { type: 'cdp' }, playwright,
    cdp: { call: async () => ({ frameTree: { frame: { id: 'frame', loaderId: 'loader',
      securityOrigin: 'https://example.com', url: 'https://example.com/login' } } }),
      protectBrowserAuthCredentialDiagnostics: () => {} },
    credentialObservationGate: { protect: async (_id: number, finish: () => void) => {
      calls.push('gate'); finish()
    } },
    runtime: { env: { BROWSER_AUTH_BROKER_CREDENTIAL_BINDING_VERSION: '1' },
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session-1' } },
      createElicitation: async () => ({ action: 'accept' }),
      gaas: { getBrowserAuthBrokerChallenge: async () => ({
        id: 'a'.repeat(32), hasSubmission: true,
        waitForSubmission: async () => ({ fields: { username: 'alice', password: 'secret' },
          native_credential_delivery: true }),
        complete: async (status: string) => status, close: () => {}
      }) } }
  }
  expect(await createCommandRegistry().tab_browser_auth_handoff({
    browser_id: 'browser', tab_id: '7', origin: 'https://example.com',
    fields: [{ id: 'username', label: 'Username', selector: '#username', type: 'text', required: true },
      { id: 'password', label: 'Password', selector: '#password', type: 'password', required: true }],
    submit: { action: 'click', selector: '#submit' }
  }, backend, undefined, () => calls.push('release-command'))).toEqual({ status: 'submitted' })
  expect(calls.slice(0, 2)).toEqual(['gate', 'release-command'])
  expect(calls).toContain('fill:#password:true')
  expect(calls).toContain('submit-check:true')
})
