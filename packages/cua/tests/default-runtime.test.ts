// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createTinyskyAlt } from '../src/default-runtime'

function browserHost() {
  const setup = vi.fn(async () => ({
    apiManifest: { interfaces: { Agent: {}, Browsers: {}, Browser: {}, Tabs: {}, Tab: {} } },
    disabledMemberIds: []
  }))
  const execute = vi.fn(async (command: any) => {
    switch (command.type) {
      case 'list_browsers': return [{ id: 'local', name: 'Local', type: 'cdp' }]
      case 'get_browser': return { id: 'local', name: 'Local', type: 'cdp',
        capabilities: { browser: [], tab: [] } }
      case 'list_tabs': return { tabs: [] }
      case 'browser_user_open_tabs': return { tabs: [] }
      case 'get_documentation': return 'local documentation'
      default: throw new Error(`unexpected browser command: ${command.type}`)
    }
  })
  return { setup, execute, displayImage: vi.fn(), close: vi.fn(async () => {}) }
}

test('browser-only default uses explicit ActionDriver host and training environment', async () => {
  const host = browserHost()
  const runtime = await createTinyskyAlt({ browserHost: host, computer: false })
  const state = await runtime.getState({ emit: false })
  expect(state.apps).toEqual([])
  expect(state.browsers).toMatchObject([{ id: 'local', tabs: [] }])
  expect(host.setup).toHaveBeenCalledWith(expect.objectContaining({ environment: 'training' }))
})

test('combined default reads browser and computer state without private RPC fallback', async () => {
  const host = browserHost()
  const privateRpc = vi.fn(() => { throw new Error('private service') })
  vi.stubGlobal('nodeRepl', { rpc: privateRpc })
  try {
    const computerHost = { request: vi.fn(async (input: any) =>
      input.operation === 'list-apps' ? { apps: [{ id: 'TextEdit' }] } : { accepted: true }) }
    const runtime = await createTinyskyAlt({ browserHost: host, computerHost, sessionId: 's' })
    expect(await runtime.getState({ emit: false })).toMatchObject({
      apps: [{ id: 'TextEdit' }], browsers: [{ id: 'local' }]
    })
    expect(privateRpc).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
