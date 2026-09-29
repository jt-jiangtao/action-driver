// @vitest-environment node
import { test, expect } from 'vitest'
import { originalDocumentation } from '../original-service'

const candidate = async () =>
  (await import('../../src/service-response-lifecycle').catch(() => ({}))) as any

test('site response contribution consumes guidance and clears multi-origin state after each submission', async () => {
  const own = await candidate()
  expect(own.createSiteResponseCollector).toBeDefined()
  const base = await originalDocumentation()
  base.resetCredentialState()
  async function run(create: any) {
    const taken: unknown[] = []
    const context = {
      browserId: 'browser',
      clientInfo: { family: 'chrome' },
      environment: 'cloud',
      getCurrentSessionId: () => 'browser-session',
      siteInstructions: {
        take: (id: number, url: string) => {
          taken.push([id, url])
          return 'Read this first'
        }
      }
    }
    const collector = create()
    const input = (currentUrl: string, _type = 'tab_screenshot') => ({
      backend: 'cdp',
      commandSucceeded: true,
      context,
      currentUrl,
      params: { tab_id: '2' },
      result: {},
      runtime: {}
    })
    collector.recordCommand('tab_screenshot', input('https://first.example/a?token=x'))
    collector.recordCommand('tab_screenshot', input('https://second.example/b'))
    const first = collector.takeResponseMetaContribution()
    const second = collector.takeResponseMetaContribution()
    return { first, second, taken }
  }
  const ownResult = await run(own.createSiteResponseCollector)
  const baselineResult = await run(base.baselineSiteResponseCollector)
  expect(JSON.parse(JSON.stringify(ownResult))).toEqual(JSON.parse(JSON.stringify(baselineResult)))
})

test('WebMCP calls record bounded JSON, preserve ordering, and clear between submissions', async () => {
  const own = await candidate()
  expect(own.createWebMcpResponseCollector).toBeDefined()
  const base = await originalDocumentation()
  async function run(create: any) {
    const context = { browserId: 'browser', clientInfo: { family: 'chrome' } }
    const collector = create()
    collector.recordCommand('webmcp_list_tools', {
      backend: 'cdp', commandSucceeded: true, context,
      currentUrl: 'https://example.com/page', params: { tab_id: '1' },
      result: { tools: ['first'] }, runtime: {}
    })
    collector.recordCommand('webmcp_invoke_tool', {
      backend: 'cdp', commandSucceeded: true, context,
      currentUrl: 'https://example.com/page',
      params: { tab_id: '1', tool_name: 'search', input: { query: 'abc' } },
      result: { result: 'found' },
      webMcpTool: { title: 'Search', description: 'Find', origin: 'https://tools.example.com', annotations: { readOnlyHint: true } },
      runtime: {}
    })
    const first = collector.takeResponseMetaContribution()
    const second = collector.takeResponseMetaContribution()
    return { first, second }
  }
  expect(await run(own.createWebMcpResponseCollector)).toEqual(
    await run(base.baselineWebMcpResponseCollector)
  )
})

test('screenshot collector prefers a later action and omits observations after native credentials', async () => {
  const own = await candidate()
  expect(own.createScreenshotResponseCollector).toBeDefined()
  const base = await originalDocumentation()
  base.configureCredentialBoundaries({
    assertHealthy: () => {}, gates: () => [], checkBroker: async () => true,
    beginCommand: () => () => {}, isUnsafe: () => false
  })
  async function run(create: any) {
    const context = {
      browserId: 'browser', clientInfo: { family: 'chrome' }, environment: 'cloud',
      credentialObservationGate: { usedNativeCredentials: true }
    }
    const collector = create()
    for (const type of ['tab_screenshot', 'cua_click'])
      collector.recordCommand(type, {
        backend: 'cdp', commandSucceeded: true, context,
        params: { tab_id: '2' }, result: {}, runtime: { env: {} }
      })
    const first = await collector.takeResponseMetaContribution()
    const second = await collector.takeResponseMetaContribution()
    return JSON.parse(JSON.stringify({ first, second }))
  }
  expect(await run(own.createScreenshotResponseCollector)).toEqual(
    await run(base.baselineScreenshotResponseCollector)
  )
})

test('after-submitted hook merges same-browser contributions, emits guidance and prioritizes handoff', async () => {
  const own = await candidate()
  expect(own.createResponseLifecycle).toBeDefined()
  const base = await originalDocumentation()
  base.configureCredentialBoundaries({
    assertHealthy: () => {}, gates: () => [], checkBroker: async () => true,
    beginCommand: () => () => {}, isUnsafe: () => false
  })
  async function run(create: any) {
    const hooks: any[] = [], metadata: unknown[] = [], content: string[] = []
    const runtime = {
      addAfterSubmittedCodeHook: (hook: any) => { hooks.push(hook); return () => {} },
      setResponseMeta: (value: unknown) => metadata.push(value),
      emitContentItem: (value: string) => content.push(value),
      credentialRegistry: {
        isUnsafe: () => false,
        gates: () => [],
        checkBroker: async () => {}
      }
    }
    const context = { browserId: 'browser', clientInfo: { family: 'chrome' } }
    const outcome = (type: string) => ({
      backend: 'cdp', commandSucceeded: true, context,
      currentUrl: 'https://example.com/page', params: { tab_id: '2' },
      result: {}, runtime, commandType: type
    })
    const collectors = [
      { recordCommand() {}, takeResponseMetaContribution: () => ({
        outcome: outcome('tab_manual_handoff_request'),
        surfaceDetails: { browserId: 'browser', manualHandoffTabId: '2' },
        cloudBrowserHandoff: { tab_id: '2', browser_conversation_id: 'conversation', connection_thread_id: 'thread' },
        siteGuidance: [{ url: 'https://example.com/page', instruction: 'Help' }]
      }) },
      { recordCommand() {}, takeResponseMetaContribution: async () => ({
        outcome: outcome('tab_screenshot'),
        surfaceDetails: { browserId: 'browser', screenshot: { tabId: '2', url: 'image' } }
      }) }
    ]
    create(collectors, runtime)
    await hooks[0].run()
    return { timeout: hooks[0].timeoutMs, metadata, content }
  }
  expect(await run(own.createResponseLifecycle)).toEqual(
    await run(base.baselineResponseLifecycle)
  )
})
