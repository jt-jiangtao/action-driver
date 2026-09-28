// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { setupBrowserRuntime } from '@actiondriver/browser-runtime'
import { createTinyskyAlt } from '../src/default-runtime'
import { originalConfiguredSession } from './original-computer-session'
test('default macOS computer loader uses candidate Sky trusted RPC and shared CUA lifecycle', async () => {
  const calls: any[] = [],
    output: string[] = []
  vi.stubGlobal('nodeRepl', {
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' },
    write: (text: string) => output.push(text),
    rpc: async (service: string, message: any) => {
      calls.push({ service, message })
      if (service === 'sky' && message.type === 'setup')
        return { target: 'mac', methods: ['list_apps'] }
      if (service === 'sky' && message.type === 'execute') return [{ id: 'app' }]
      throw new Error('unexpected request')
    }
  })
  try {
    const runtime = await createTinyskyAlt({ browser: false })
    expect(await runtime.getState()).toEqual({ apps: [{ id: 'app' }], browsers: [] })
    expect(output.length).toBeGreaterThan(0)
    expect(calls).toContainEqual({ service: 'sky', message: { type: 'setup' } })
  } finally {
    vi.unstubAllGlobals()
  }
})
test('default browser loader uses candidate setup/factory/tab decorator with shared session', async () => {
  const calls: any[] = []
  vi.stubGlobal('nodeRepl', {
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' },
    rpc: async (service: string, request: any) => {
      calls.push({ service, request })
      if (request.method === 'setup')
        return {
          apiManifest: {
            interfaces: { Agent: {}, Browsers: {}, Browser: {}, Tabs: {}, Tab: { ax: {} } }
          },
          disabledMemberIds: ['Tab.ax']
        }
      switch (request.params.type) {
        case 'list_browsers':
          return [{ id: 'b', name: 'B', type: 'iab' }]
        case 'get_browser':
          return { id: 'b', type: 'iab' }
        case 'list_tabs':
          return { tabs: [] }
        case 'browser_user_open_tabs':
          return { tabs: [] }
        case 'get_documentation':
          return 'browser guidance'
        default:
          throw new Error('unexpected ' + request.params.type)
      }
    }
  })
  try {
    await originalConfiguredSession(
      setupBrowserRuntime,
      undefined,
      (globalThis as any).nodeRepl,
      { computer: false }
    )
    const referenceDocumentation = await (globalThis as any).agent.documentation.get('browser')
    const runtime = await createTinyskyAlt({ computer: false })
    const state = await runtime.getState()
    expect(state.apps).toEqual([])
    expect(state.browsers).toHaveLength(1)
    expect(calls[0].request.params.undocumentedApiMembers).toEqual(['Tab.ax'])
    expect(await (globalThis as any).agent.documentation.get('browser')).toBe(referenceDocumentation)
  } finally {
    vi.unstubAllGlobals()
  }
})
