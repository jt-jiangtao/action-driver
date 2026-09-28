// @vitest-environment node
import { expect, test } from 'vitest'

test('browser command dispatcher enforces documentation, credential gate and security before concrete handler', async () => {
  const { createBrowserCommandDispatcher } = await import('../src/service-command-dispatch').catch(() => ({} as any)) as any
  expect(typeof createBrowserCommandDispatcher).toBe('function')
  const calls: string[] = []
  const backend = {
    clientInfo: { type: 'extension' },
    browserId: '1',
    security: {
      runCommand: async (_command: unknown, run: (allowed: unknown) => Promise<unknown>) => {
        calls.push('security'); return run({ expectedTabUrl: 'https://example.test/' })
      },
      runNavigation: async (_id: number, _url: string, run: (permit: unknown) => Promise<unknown>) => {
        calls.push('navigation'); return run(Promise.resolve())
      }
    },
    tabLifecycle: { needsReclaim: () => false },
    followSessionTab: async () => { calls.push('follow') },
    executeUnhandledCommand: async () => { calls.push('unhandled'); return { fallback: true } }
  }
  const api = { addCloseListener: () => () => {} }, browser = { id: '1', info: backend.clientInfo, api }
  const context = {
    refresh: async () => {}, list: async () => [browser], get: async () => browser,
    getDefault: async () => browser, getForUrl: async () => browser,
    preferredWindowIdFor: () => undefined
  }
  const credential = {
    assertHealthy: () => calls.push('credential'),
    gates: () => [], checkBroker: async () => calls.push('broker'),
    beginCommand: () => { calls.push('begin'); return () => calls.push('end') },
    isUnsafe: () => false
  }
  const docs = { assertRequiredDocumentationRead: (name: string) => calls.push(`docs:${name}`) }
  const dispatch = createBrowserCommandDispatcher({
    context, credential, docs, host: { env: {} },
    createBackend: () => backend,
    handlers: { get_tab: async (params: any) => { calls.push(`handler:${params.expected_url}`); return { id: '3' } } }
  })
  const result = await dispatch({ type: 'get_tab', browser_id: '1', tab_id: 3 })
  expect(result).toEqual({ id: '3' })
  expect(calls).toEqual(['credential', 'begin', 'broker', 'docs:get_tab', 'security',
    'handler:undefined', 'broker', 'end'])
})

test('dispatcher rejects missing browser ID and routes unknown commands only after security', async () => {
  const { createBrowserCommandDispatcher } = await import('../src/service-command-dispatch').catch(() => ({} as any)) as any
  const calls: string[] = []
  const backend = {
    clientInfo: { type: 'cdp' }, browserId: '1',
    security: { runCommand: async (_: unknown, run: (x: unknown) => Promise<unknown>) => {
      calls.push('security'); return run(undefined)
    } },
    tabLifecycle: { needsReclaim: () => false },
    executeUnhandledCommand: async (input: unknown) => { calls.push('fallback'); return input }
  }
  const browser = { id: '1', info: backend.clientInfo, api: { addCloseListener: () => () => {} } }
  const dispatch = createBrowserCommandDispatcher({
    context: { get: async () => browser },
    credential: { assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => {}, isUnsafe: () => false },
    docs: { assertRequiredDocumentationRead: () => calls.push('docs') },
    host: { env: {} }, createBackend: () => backend, handlers: {}
  })
  await expect(dispatch({ type: 'future_command' })).rejects.toThrow('Browser ID must be provided')
  expect(await dispatch({ type: 'future_command', browser_id: '1', tab_id: 3 }))
    .toEqual({ type: 'future_command', browser_id: '1', tab_id: 3 })
  expect(calls).toEqual(['docs', 'docs', 'security', 'fallback'])
})

test('WebMCP registration is resolved before permission review and invocation notification', async () => {
  const { createBrowserCommandDispatcher } = await import('../src/service-command-dispatch')
  const calls: unknown[] = []
  const backend = {
    browserId: '1', clientInfo: { type: 'iab' },
    webMcp: { resolveRegistration: (id: number, registration: string) => {
      calls.push(['resolve', id, registration])
      return { name: 'search', title: 'Search', description: 'Find', origin: 'https://example.test' }
    } },
    api: { sendWebMcpToolInvoked: (input: unknown) => calls.push(['notify', input]) },
    security: { runCommand: async (command: any, run: (allowed: unknown) => Promise<unknown>) => {
      calls.push(['review', command.params.tool_name, command.params.tool_origin])
      return run(undefined)
    } },
    tabLifecycle: { needsReclaim: () => false },
    executeUnhandledCommand: async () => { throw Error('unexpected fallback') }
  }
  const browser = { id: '1', info: backend.clientInfo, api: { addCloseListener: () => () => {} } }
  const dispatch = createBrowserCommandDispatcher({
    context: { get: async () => browser },
    credential: { assertHealthy() {}, gates: () => [], checkBroker: async () => {},
      beginCommand: () => () => {}, isUnsafe: () => false },
    docs: { assertRequiredDocumentationRead() {} }, host: { env: {}, requestMeta: { callId: 'call-1' } },
    createBackend: () => backend,
    handlers: { webmcp_invoke_tool: async (params: any) => {
      calls.push(['handler', params.tool_name]); return { result: 'ok' }
    } }
  } as any)
  expect(await dispatch({ type: 'webmcp_invoke_tool', browser_id: '1', tab_id: 3,
    registration_id: 'registration-1' })).toEqual({ result: 'ok' })
  expect(calls).toEqual([
    ['resolve', 3, 'registration-1'],
    ['review', 'search', 'https://example.test'],
    ['notify', { parentCallId: 'call-1', tabId: 3, toolName: 'search' }],
    ['handler', 'search']
  ])
})
