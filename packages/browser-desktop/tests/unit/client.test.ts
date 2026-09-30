// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { setupBrowserDesktop } from '../../src/index'

test('desktop client shares the explicit browser-runtime transport', async () => {
  const host = {
    setup: vi.fn(async () => ({ apiManifest: { interfaces: { Agent: {}, Browsers: {}, Documentation: {} } }, disabledMemberIds: [] })),
    execute: vi.fn(async (command: any) => command.type === 'list_browsers' ? [] : 'docs'),
    displayImage: vi.fn(), close: vi.fn(async () => {})
  }
  const client = await setupBrowserDesktop({ host, environment: 'training' })
  expect(await client.browsers.list()).toEqual([])
  expect(host.execute).toHaveBeenCalledWith({ type: 'list_browsers', client_timeout_ms: undefined })
})

test('codex-app ordinary browser discovery reaches the owned host', async () => {
  const host = {
    setup: vi.fn(async () => ({ apiManifest: { interfaces: { Agent: {}, Browsers: {}, Documentation: {} } }, disabledMemberIds: [] })),
    execute: vi.fn(async (command: { type: string }) =>
      command.type === 'list_browsers' ? [{ id: 'local', name: 'Action-Driver Chrome' }] : 'docs'),
    displayImage: vi.fn(), close: vi.fn(async () => {})
  }
  const client = await setupBrowserDesktop({ host, environment: 'codex-app' })
  expect(await client.browsers.list()).toEqual([{ id: 'local', name: 'Action-Driver Chrome' }])
  expect(host.execute).toHaveBeenCalledTimes(1)
})

test('codex-app client refuses credential handoff before sending it to the owned host', async () => {
  const host = {
    setup: vi.fn(async () => ({
      apiManifest: { interfaces: { Agent: {}, Browsers: {}, Browser: {}, Tabs: {}, Tab: {} } },
      disabledMemberIds: []
    })),
    execute: vi.fn(async (command: { type: string }) => {
      if (command.type === 'get_browser') return {
        id: 'local', type: 'cdp', capabilities: { browser: [], tab: [{ id: 'browserAuth' }] }
      }
      if (command.type === 'get_tab') return { id: 't' }
      return { status: 'submitted' }
    }),
    displayImage: vi.fn(), close: vi.fn(async () => {})
  }
  const client = await setupBrowserDesktop({ host, environment: 'codex-app' })
  const tab = await (await client.browsers.get('local')).tabs.get('t')
  const auth = await tab.capabilities.get('browserAuth') as unknown as {
    request(input: unknown): Promise<unknown>
  }
  await expect(auth.request({ origin: 'https://example.test', fields: [], qr_code: true }))
    .rejects.toThrow('BROWSER_AUTH_SAFETY_PRECHECK_UNAVAILABLE')
  expect(host.execute.mock.calls.map(([command]) => command.type))
    .toEqual(['get_browser', 'get_tab'])
})

test('desktop client accepts an owned host whose methods are on its prototype', async () => {
  class Host {
    async setup() {
      return { apiManifest: { interfaces: { Agent: {}, Browsers: {}, Documentation: {} } }, disabledMemberIds: [] }
    }
    async execute(command: { type: string }) {
      return command.type === 'list_browsers' ? [{ id: 'local' }] : 'docs'
    }
    displayImage() {}
    async close() {}
  }
  const client = await setupBrowserDesktop({ host: new Host(), environment: 'training' })
  expect(await client.browsers.list()).toEqual([{ id: 'local' }])
})
