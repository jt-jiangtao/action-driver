// @vitest-environment node
import { expect, test } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

async function originalRuntimeSetupProbe(calls: string[], audit?: Record<string, unknown>) {
  const source = await readFile(resolve(
    'packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs'
  ), 'utf8')
  const dependency = pathToFileURL(resolve('packages/browser-runtime/node_modules/classic-level/index.js')).href
  const module = await import('data:text/javascript;base64,' + Buffer.from(
    source.replace('../node_modules/classic-level.mjs', dependency) +
      '\nexport {SN as baselineSN}; export function probeTelemetry(record){Kn();mD=async()=>record("statsig");bD=async()=>record("sdk-user");Pm=(_host,name,value,metadata)=>record(name==="codex_browser_use_security_check"?JSON.stringify({name,value,metadata}):name);pt=()=>{}} export function probeAudit(event){St(()=>event)}'
  ).toString('base64'))
  module.probeTelemetry((value: string) => calls.push(value))
  const host = {
    env: {}, platform: 'darwin',
    fetch: async () => ({ ok: true, json: async () => ({ object: 'user', id: 'id' }) }),
    errorReporter: {
      captureException: () => {},
      setUser: () => calls.push('reporter-user'),
      setTag: () => {}
    },
    filesystem: { readFile: async () => '' },
    browserContext: { dispose: async () => {} },
    commandTiming: {}, performanceSpan: {},
    addAfterSubmittedCodeHook: () => {}
  }
  await module.baselineSN({ environment: 'codex-app' }, host)
  if (audit) module.probeAudit(audit)
  await Promise.resolve()
}

test('native runtime publishes telemetry at original service setup boundaries', async () => {
  const expected: string[] = []
  await originalRuntimeSetupProbe(expected)
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime')
  const actual: string[] = []
  const host = {
    env: {}, platform: 'darwin',
    errorReporter: { captureException: () => {}, setUser: () => {}, setTag: () => {} },
    browserContext: {}, credentialRegistry: {}, commandTiming: {}, performanceSpan: {},
    config: {}, filesystem: {}
  }
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' }, {
    telemetry: {
      initialize: () => {
        actual.push('statsig')
        setTimeout(() => { actual.push('reporter-user'); actual.push('sdk-user') }, 0)
      },
      logEvent: (_host: unknown, name: string) => actual.push('codex_' + name)
    }
  } as any)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await runtime.dispose()
  const lifecycle = (events: string[]) => events.filter((event) =>
    event !== 'reporter-user' && event !== 'sdk-user')
  expect(lifecycle(actual)).toEqual(lifecycle(expected))
  expect(actual.filter((event) => event === 'reporter-user' || event === 'sdk-user'))
    .toEqual(expected.filter((event) => event === 'reporter-user' || event === 'sdk-user'))
})

test('native runtime installs original security audit telemetry callback', async () => {
  const event = {
    check: 'file-download', outcome: 'denied', backend: 'extension',
    browserFamily: 'edge', durationMs: 23, httpStatus: 403,
    permissionSource: 'user_decision', reason: 'user_declined'
  }
  const expected: string[] = []
  await originalRuntimeSetupProbe(expected, event)
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime')
  const { emitSecurityAudit } = await import('../../src/service-security-approval')
  const actual: string[] = []
  const host = {
    env: { BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' }, platform: 'darwin',
    errorReporter: { captureException: () => {}, setUser: () => {}, setTag: () => {} },
    browserContext: {}, credentialRegistry: {}, commandTiming: {}, performanceSpan: {},
    config: {}, filesystem: {}
  }
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' }, {
    telemetry: {
      initialize: () => {},
      logEvent: (_host: unknown, name: string, value: unknown, metadata: unknown) =>
        actual.push(name === 'browser_use_security_check'
          ? JSON.stringify({ name: 'codex_' + name, value, metadata }) : 'codex_' + name)
    }
  } as any)
  try {
    emitSecurityAudit(() => event)
    expect(JSON.parse(actual.at(-1)!)).toEqual(JSON.parse(expected.at(-1)!))
  } finally {
    await runtime.dispose()
  }
})

test('pre-release telemetry begin is consumed once by native assembly', async () => {
  const { beginNativeRuntimeTelemetry, createNativeRuntimeFromInitialized } =
    await import('../../src/service-native-runtime')
  const calls: string[] = []
  const host = {
    env: {}, platform: 'darwin',
    errorReporter: { captureException: () => {}, setUser: () => {}, setTag: () => {} },
    browserContext: {}, credentialRegistry: {}, commandTiming: {}, performanceSpan: {},
    config: {}, filesystem: {}
  }
  const telemetry = {
    initialize: () => calls.push('initialize'),
    logEvent: (_host: unknown, name: string) => calls.push(name)
  }
  beginNativeRuntimeTelemetry(host as any, telemetry as any)
  calls.push('old-release')
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' },
    { telemetry: telemetry as any })
  await runtime.dispose()
  expect(calls).toEqual([
    'initialize', 'browser_use_invocation_started', 'old-release',
    'browser_use_setup', 'browser_use_invocation_ready'
  ])
})

test('initialized candidate runtime publishes original manifest and routes global and browser commands', async () => {
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime').catch(() => ({} as any)) as any
  expect(typeof createNativeRuntimeFromInitialized).toBe('function')
  const calls: string[] = [], api = { addCloseListener: () => () => {} }
  const browser = { id: '7', info: { name: 'Test', type: 'cdp', capabilities: { browser: [], tab: [] } }, api }
  const browserContext = {
    get: async () => browser, getDefault: async () => browser, getForUrl: async () => browser,
    list: async () => [browser], refresh: async () => {}, preferredWindowIdFor: () => undefined
  }
  const initialized = {
    env: {}, platform: 'darwin', browserContext,
    credentialRegistry: {
      assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => {}, isUnsafe: () => false
    },
    commandTiming: {}, performanceSpan: {}, config: {}, filesystem: {}
  }
  const runtime = await createNativeRuntimeFromInitialized(
    initialized,
    { environment: 'codex-app' },
    {
      createBackend: () => ({
        browserId: '7', clientInfo: browser.info,
        security: { runCommand: async (_: unknown, run: (x: unknown) => Promise<unknown>) => run(undefined) },
        tabLifecycle: { needsReclaim: () => false },
        executeUnhandledCommand: async () => { throw Error('unexpected fallback') }
      }),
      handlers: { get_tab: async () => { calls.push('get_tab'); return { id: '3' } } }
    }
  )
  expect(runtime.apiManifest.root).toBe('Agent')
  expect(runtime.disabledMemberIds).toEqual(new Set())
  expect(await runtime.executeAgentCommand({ type: 'get_browser', id: '7' })).toMatchObject({ id: '7', type: 'cdp' })
  expect(await runtime.executeAgentCommand({ type: 'get_tab', browser_id: '7', tab_id: 3 })).toEqual({ id: '3' })
  expect(calls).toEqual(['get_tab'])
})

test('native runtime wires after-submission metadata, notifications and backend cleanup', async () => {
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime')
  const hooks: any[] = [], metadata: unknown[] = [], content: string[] = [], calls: string[] = []
  const api = { addCloseListener: () => () => {}, takePageEvents: () => [], matchesCurrentSessionId: () => true }
  const browser = { id: '7', info: { name: 'Test', type: 'cdp', family: 'chrome' }, api }
  const host = {
    env: {}, platform: 'darwin',
    addAfterSubmittedCodeHook: (hook: any) => { hooks.push(hook); return () => calls.push('remove-hook') },
    setResponseMeta: (value: unknown) => metadata.push(value),
    emitContentItem: (value: string) => content.push(value),
    browserContext: {
      get: async () => browser, getDefault: async () => browser,
      list: async () => [browser], refresh: async () => {},
      preferredWindowIdFor: () => undefined,
      dispose: async () => calls.push('context-dispose')
    },
    credentialRegistry: {
      assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => {}, isUnsafe: () => false
    },
    commandTiming: {}, performanceSpan: {}, config: {}, filesystem: {}
  }
  const backend = {
    browserId: '7', clientInfo: browser.info, environment: 'codex-app',
    security: { runCommand: async (_: unknown, run: (x: unknown) => Promise<unknown>) => run(undefined) },
    tabLifecycle: { needsReclaim: () => false, takeEvents: () => [] },
    cdp: { currentTopLevelUrl: () => 'https://example.com/page' },
    siteInstructions: { take: () => 'Site guidance' },
    preferences: { isWebMcpEnabled: async () => false },
    webMcp: { clearSessionSnapshots: () => {} },
    getCurrentSessionId: () => 'session',
    executeUnhandledCommand: async () => { throw Error('unexpected fallback') },
    dispose: async () => calls.push('backend-dispose')
  }
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' }, {
    createBackend: () => backend,
    handlers: { get_tab: async () => ({ id: '3' }) }
  })
  expect(hooks.map((hook) => hook.timeoutMs)).toEqual([10000, 12000])
  await runtime.executeAgentCommand({ type: 'get_tab', browser_id: '7', tab_id: 3 })
  await hooks[0].run()
  await hooks[1].run()
  expect(metadata).toContainEqual({ 'codex/browserSiteGuidance': [{ url: 'https://example.com/page', instruction: 'Site guidance' }] })
  expect(metadata.some((value: any) => value['codex/browserUse'] === true)).toBe(true)
  expect(content).toEqual([])
  await runtime.dispose()
  expect(calls).toEqual(['remove-hook', 'remove-hook', 'backend-dispose'])
})

test('native runtime dispatches a real BrowserBackend tab command and closes its transport', async () => {
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime')
  class BrowserApi extends EventEmitter {
    detachTurn: unknown
    closed = 0
    addEventListener(name: string, listener: (...args: any[]) => void) { this.on(name, listener) }
    addCloseListener(listener: () => void) { this.on('close', listener); return () => this.off('close', listener) }
    getCurrentSessionId() { return 'session' }
    getCurrentTurnId() { return 'turn' }
    getTabs() { return Promise.resolve([]) }
    getUserTabs() { return Promise.resolve([]) }
    getCommittedTabUrl() { return Promise.resolve('https://example.test/') }
    getInfo() { return Promise.resolve({ capabilities: { tab: [] } }) }
    executeCdp() { return Promise.resolve({}) }
    close() { this.closed++; return Promise.resolve() }
    attach() { return Promise.resolve() }
    detach() { return Promise.resolve() }
  }
  const api = new BrowserApi()
  const browser = { id: '7', info: { name: 'Test', type: 'iab', family: 'chrome' }, api }
  const host = {
    env: {}, platform: 'darwin', requestMeta: {},
    config: { read: async () => ({}), readRequirements: async () => ({}) },
    browserContext: {
      get: async () => browser, getDefault: async () => browser,
      list: async () => [browser], refresh: async () => {},
      preferredWindowIdFor: () => undefined
    },
    credentialRegistry: {
      assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => {}, isUnsafe: () => false,
      get: () => ({ usedNativeCredentials: false, bindNavigationEvents: () => () => {} })
    },
    commandTiming: { startCommand: () => ({ run: (action: () => Promise<unknown>) => action(), finish() {} }) },
    performanceSpan: {}, filesystem: {}
  }
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' })
  try {
    expect(await runtime.executeAgentCommand({ type: 'list_tabs', browser_id: '7' })).toEqual({ tabs: [] })
  } finally { await runtime.dispose() }
  expect(api.closed).toBe(1)
  expect(api.listenerCount('close')).toBe(0)
})

test('default native runtime reaches a concrete Playwright handler through the guarded dispatcher', async () => {
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime')
  const { PlaywrightInput } = await import('../../src/service-playwright-input')
  const dom = new JSDOM('<body><input id="field"><button id="go">Go</button></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true
  })
  const calls: string[] = []
  const cdp = Object.assign(new EventEmitter(), {
    platform: 'darwin',
    call: async (_tabId: number, method: string, params?: { expression?: string }) => {
      calls.push(method)
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
      if (method === 'Runtime.evaluate')
        return { result: { value: await dom.window.eval(params?.expression ?? '') } }
      return {}
    },
    callTarget: async (_target: unknown, method: string, params?: { expression?: string }) =>
      await cdp.call(3, method, params)
  })
  const span = { currentPlaywrightOperation: (name: string) => name }
  const timing = { startLocatorRetry: () => ({ attemptFailed() {}, finish() {} }) }
  const playwright = new PlaywrightInput(cdp as any, {} as any, span, timing)
  const api = { addCloseListener: () => () => {} }
  const browser = { id: '7', info: { name: 'Test', type: 'cdp', capabilities: { browser: [], tab: [] } }, api }
  const host = {
    env: {}, platform: 'darwin',
    browserContext: { get: async () => browser },
    credentialRegistry: {
      assertHealthy: () => calls.push('healthy'), gates: () => [],
      checkBroker: async () => calls.push('broker'),
      beginCommand: () => { calls.push('begin'); return () => calls.push('end') },
      isUnsafe: () => false
    },
    commandTiming: timing, performanceSpan: {}, config: {}, filesystem: {}
  }
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' }, {
    createBackend: () => ({
      browserId: '7', clientInfo: browser.info, playwright,
      security: { runCommand: async (_command: unknown, run: (allowed: unknown) => Promise<unknown>) => {
        calls.push('security')
        return await run(undefined)
      } },
      tabLifecycle: { needsReclaim: () => false },
      executeUnhandledCommand: async () => { throw Error('unexpected fallback') }
    })
  } as any)
  try {
    expect(await runtime.executeAgentCommand({ type: 'playwright_locator_count',
      browser_id: '7', tab_id: 3, selector: 'input, button' })).toEqual({ count: 2 })
    expect(calls).toEqual(['healthy', 'begin', 'broker', 'security',
      'Runtime.evaluate', 'Runtime.evaluate', 'broker', 'end'])
    await expect(runtime.executeAgentCommand({ type: 'playwright_locator_fill',
      browser_id: '7', tab_id: 3, selector: '#field', value: 42 }))
      .rejects.toThrow('playwright_locator_fill requires string value')
    expect(calls.slice(-6)).toEqual(['healthy', 'begin', 'broker', 'security', 'broker', 'end'])
  } finally {
    await runtime.dispose()
    dom.window.close()
  }
})

test('default BrowserBackend reads and changes page state over its own CDP attachment', async () => {
  const { createNativeRuntimeFromInitialized } = await import('../../src/service-native-runtime')
  const dom = new JSDOM('<body><input id="field"><button id="go">Go</button><select id="choice"><option value="a">A</option><option value="b">B</option></select></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true,
    url: 'https://example.test/'
  })
  dom.window.Element.prototype.getClientRects = () =>
    [{ left: 10, right: 110, top: 20, bottom: 50, width: 100, height: 30 }] as any
  dom.window.Element.prototype.getBoundingClientRect = () =>
    ({ left: 10, right: 110, top: 20, bottom: 50, width: 100, height: 30 }) as any
  dom.window.Element.prototype.scrollIntoView = () => {}
  const methods: string[] = []
  class BrowserApi extends EventEmitter {
    closed = 0
    remainingEvaluateFailures = 0
    addEventListener(name: string, listener: (...args: any[]) => void) { this.on(name, listener) }
    addCloseListener(listener: () => void) { this.on('close', listener); return () => this.off('close', listener) }
    getCurrentSessionId() { return 'session' }
    getCurrentTurnId() { return 'turn' }
    getTabs() { return Promise.resolve([{ id: 3, url: 'https://example.test/' }]) }
    getUserTabs() { return Promise.resolve([]) }
    getCommittedTabUrl() { return Promise.resolve('https://example.test/') }
    getInfo() { return Promise.resolve({ capabilities: { tab: [] } }) }
    attach() { return Promise.resolve() }
    detach() { return Promise.resolve() }
    async executeCdp(input: { method: string; commandParams: { expression?: string } }) {
      methods.push(input.method)
      if (input.method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
      if (input.method === 'Runtime.addBinding') {
        const name = (input.commandParams as { name?: string }).name
        if (name) Object.defineProperty(dom.window, name, { configurable: true, value: () => {} })
        return {}
      }
      if (input.method === 'Page.addScriptToEvaluateOnNewDocument') {
        const source = (input.commandParams as { source?: string }).source
        if (source) await dom.window.eval(source)
        return { identifier: 'fixture-script' }
      }
      if (input.method === 'Runtime.evaluate') {
        if (this.remainingEvaluateFailures > 0) {
          this.remainingEvaluateFailures--
          throw Error('fixture CDP disconnected')
        }
        return { result: { value: await dom.window.eval(input.commandParams.expression ?? '') } }
      }
      return {}
    }
    executeCdpWithCachedExpression(input: { method: string; commandParams: { expression?: string } }) {
      return this.executeCdp(input)
    }
    close() { this.closed++; return Promise.resolve() }
  }
  const api = new BrowserApi()
  const browser = { id: '7', info: { name: 'Test', type: 'iab', family: 'chrome' }, api }
  const host = {
    env: { BROWSER_USE_SECURITY_MODE: 'disabled-for-local-testing' }, platform: 'darwin',
    requestMeta: {},
    config: { read: async () => ({}), readRequirements: async () => ({}) },
    browserContext: {
      get: async () => browser, getDefault: async () => browser,
      list: async () => [browser], refresh: async () => {},
      preferredWindowIdFor: () => undefined
    },
    credentialRegistry: {
      assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => {}, isUnsafe: () => false,
      get: () => ({ usedNativeCredentials: false, bindNavigationEvents: () => () => {} })
    },
    commandTiming: {
      startCommand: () => ({ run: (action: () => Promise<unknown>) => action(), finish() {} }),
      startLocatorRetry: () => ({ attemptFailed() {}, finish() {} })
    },
    performanceSpan: {
      withSpan: async (_name: string, _attrs: unknown, run: () => Promise<unknown>) => await run(),
      currentCommandAttrs: () => ({}),
      currentPlaywrightOperation: (name: string) => name
    },
    filesystem: {}
  }
  const runtime = await createNativeRuntimeFromInitialized(host as any, { environment: 'codex-app' })
  try {
    expect(await runtime.executeAgentCommand({ type: 'playwright_locator_count',
      browser_id: '7', tab_id: 3, selector: 'input, button' })).toEqual({ count: 2 })
    expect(await runtime.executeAgentCommand({ type: 'playwright_locator_select_option',
      browser_id: '7', tab_id: 3, selector: '#choice', selections: [{ value: 'b' }] })).toEqual({})
    expect((dom.window.document.querySelector('#choice') as HTMLSelectElement).value).toBe('b')
    expect(await runtime.executeAgentCommand({ type: 'playwright_locator_fill',
      browser_id: '7', tab_id: 3, selector: '#field', value: 'through backend' })).toEqual({})
    expect((dom.window.document.querySelector('#field') as HTMLInputElement).value)
      .toBe('through backend')
    api.remainingEvaluateFailures = 1
    expect(await runtime.executeAgentCommand({ type: 'playwright_locator_count',
      browser_id: '7', tab_id: 3, selector: 'input, button' })).toEqual({ count: 2 })
    expect(api.remainingEvaluateFailures).toBe(0)
    api.remainingEvaluateFailures = 100
    await expect(runtime.executeAgentCommand({ type: 'playwright_locator_count',
      browser_id: '7', tab_id: 3, selector: 'input, button', timeout_ms: 0 }))
      .rejects.toThrow('Playwright selector deadline exceeded')
    api.remainingEvaluateFailures = 0
    expect(await runtime.executeAgentCommand({ type: 'playwright_locator_count',
      browser_id: '7', tab_id: 3, selector: 'input, button' })).toEqual({ count: 2 })
    expect(methods).toContain('Runtime.evaluate')
  } finally {
    await runtime.dispose()
    dom.window.close()
  }
  expect(api.closed).toBe(1)
  expect(methods).toContain('Runtime.removeBinding')
  expect(methods).toContain('Page.removeScriptToEvaluateOnNewDocument')
})
