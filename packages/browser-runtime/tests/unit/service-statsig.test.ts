// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserStatsig } from '../../src/service-statsig'
import { originalDocumentation } from '../original-service'
function fixture() {
  const calls: any[] = []
  class Sdk {
    loadingStatus = 'Ready'
    constructor(key: any, user: any, options: any) {
      calls.push([
        'construct',
        key,
        user,
        { ...options, networkConfig: { ...options.networkConfig, networkOverrideFunc: 'fetch' } }
      ])
    }
    async initializeAsync(options: any) {
      calls.push(['initialize', options])
      return { success: true }
    }
    checkGate(name: string) {
      calls.push(['gate', name])
      return true
    }
    getFeatureGate(name: string) {
      return {
        value: true,
        details: { reason: name === 'missing' ? 'Unrecognized' : 'Network:Recognized' }
      }
    }
    getDynamicConfig(name: string) {
      return { name }
    }
    logEvent(...args: any[]) {
      calls.push(['event', ...args])
    }
    async updateUserAsync(...args: any[]) {
      calls.push(['update', ...args])
      return { success: true }
    }
  }
  return { calls, Sdk }
}
test('browser Statsig initializes once, updates identity and preserves gates and event build metadata', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const f = fixture(),
      api = original ? base.configureStatsig(f.Sdk) : new BrowserStatsig(() => f.Sdk),
      host = {
        platform: 'darwin',
        env: {
          BROWSER_USE_BROWSER_CLIENT_BUILD: ' build ',
          BROWSER_USE_CODEX_APP_VERSION: ' version ',
          NODE_REPL_SENTRY_USER_ID: ' user '
        },
        fetch: async () => {
          throw Error('network unexpected')
        }
      }
    await api.initialize(host)
    await api.initialize(host)
    const gate = api.checkGate(host, 'enabled'),
      disabled = api.checkGate(
        { ...host, env: { ...host.env, BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' } },
        'enabled',
        { enabledByDefault: true }
      ),
      header = await api.requestHeader('enabled')
    let error
    try {
      await api.requestHeader('missing')
    } catch (e: any) {
      error = e.message
    }
    api.logEvent(host, 'name', 'value', { action: 'test' })
    api.setBackend(host, 'iab')
    await api.updateUser(host, { id: 'changed', email: 'test@example.com' })
    const config = api.dynamicConfig('config')
    return { calls: f.calls, gate, disabled, header, error, config }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('request header policy rejects when initialization is absent', async () => {
  await expect(new BrowserStatsig(() => fixture().Sdk).requestHeader('gate')).rejects.toThrow(
    'Browser request-header policy requires Statsig initialization.'
  )
})
test('failed or unready SDK values cannot authorize request headers', async () => {
  const base = await originalDocumentation()
  for (const reject of [true, false]) {
    async function exercise(original: boolean) {
      const f = fixture()
      class Failed extends f.Sdk {
        override loadingStatus = 'Uninitialized'
        override async initializeAsync() {
          if (reject) throw Error('SDK unavailable')
          return { success: false }
        }
      }
      const api = original ? base.configureStatsig(Failed) : new BrowserStatsig(() => Failed),
        host = {
          platform: 'darwin',
          env: {},
          fetch: async () => {
            throw Error('unexpected fetch')
          }
        }
      const warning = console.warn
      const warnings: string[] = []
      console.warn = (error: any) => warnings.push(error.message)
      try {
        await api.initialize(host)
        let error
        try {
          await api.requestHeader('enabled')
        } catch (e: any) {
          error = e.message
        }
        return { error, warnings, gate: api.checkGate(host, 'gate') }
      } finally {
        console.warn = warning
      }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
