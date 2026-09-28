// @vitest-environment node
import { test, expect } from 'vitest'
import { originalDocumentation } from './original-service'

const candidate = async () =>
  (await import('../src/service-browser-notifications').catch(() => ({}))) as any

test('after-submitted browser notification hook consumes events and emits nothing while WebMCP is disabled', async () => {
  const own = await candidate()
  expect(own.createBrowserNotifications).toBeDefined()
  const base = await originalDocumentation()
  base.configureCredentialBoundaries({
    assertHealthy: () => {}, gates: () => [], checkBroker: async () => true,
    beginCommand: () => () => {}, isUnsafe: () => false
  })
  async function run(original: boolean) {
    const hooks: any[] = [], content: string[] = [], consumed: string[] = []
    const host = {
      addAfterSubmittedCodeHook: (hook: any) => { hooks.push(hook); return () => {} },
      emitContentItem: (value: string) => content.push(value),
      credentialRegistry: { isUnsafe: () => false, gates: () => [], checkBroker: async () => {} }
    }
    const api = {
      takePageEvents: () => { consumed.push('page'); return [{ type: 'webmcp_changed', version: 1, tabId: 2, session_id: 'current' }] },
      matchesCurrentSessionId: (id: string) => id === 'current'
    }
    const backend = {
      api,
      cdp: {},
      preferences: { isWebMcpEnabled: async () => false },
      tabLifecycle: { takeEvents: () => { consumed.push('tab'); return [{ type: 'tab_acquired', tabId: 2, origin: 'external' }] } }
    }
    if (original) {
      base.baselineQueueBrowserNotifications(api, backend)
      const result = await base.baselineBrowserNotifications()
      return { result, consumed }
    }
    const notifications = own.createBrowserNotifications(host)
    notifications.queue(api, backend)
    await hooks[0].run()
    return { result: content[0] ?? '', consumed, timeout: hooks[0].timeoutMs }
  }
  const actual = await run(false)
  const expected = await run(true)
  expect({ result: actual.result, consumed: actual.consumed }).toEqual(expected)
  expect(actual.timeout).toBe(12000)
})

test('browser notification hook emits one notice per changed or externally acquired tab', async () => {
  const own = await candidate()
  expect(own.createBrowserNotifications).toBeDefined()
  const hooks: any[] = [], emitted: string[] = [], requested: number[] = []
  const host = {
    addAfterSubmittedCodeHook: (hook: any) => { hooks.push(hook); return () => {} },
    emitContentItem: (value: string) => emitted.push(value),
    credentialRegistry: { isUnsafe: () => false, gates: () => [], checkBroker: async () => {} }
  }
  const api = {
    takePageEvents: () => [{ type: 'webmcp_changed', version: 1, tabId: 2, session_id: 'current' }],
    matchesCurrentSessionId: (id: string) => id === 'current'
  }
  const backend = {
    api,
    cdp: {},
    preferences: { isWebMcpEnabled: async () => true },
    getCurrentSessionId: () => 'current',
    tabLifecycle: { takeEvents: () => [{ type: 'tab_acquired', tabId: 3, origin: 'external' }] },
    security: { runCommand: async (_command: unknown, run: () => Promise<unknown>) => await run() },
    webMcp: { pendingNotificationTabIds: () => [], notificationForTab: async (id: number) => {
      requested.push(id)
      return `Tools changed in ${id}`
    } }
  }
  const notifications = own.createBrowserNotifications(host)
  notifications.queue(api, backend)
  await hooks[0].run()
  expect(requested).toEqual([2, 3])
  expect(emitted).toEqual(['Browser notifications:\n\nTools changed in 2\n\nTools changed in 3\n'])
})
