// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserTelemetry } from '../src/service-telemetry'
import { originalDocumentation } from './original-service'
test('telemetry captures verified caller identity once and waits for identity before request-header policy', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean, valid: boolean) {
    const calls: any[] = [],
      sdk = {
        initialize: async () => calls.push(['initialize']),
        setBackend: (_host: any, backend: string) => calls.push(['backend', backend]),
        updateUser: async (_host: any, user: any) => calls.push(['sdkUser', user]),
        logEvent: (_host: any, ...args: any[]) => calls.push(['event', ...args]),
        requestHeader: async (name: string) => {
          calls.push(['gate', name])
          return true
        },
        capture: (error: any) => calls.push(['error', error.message])
      },
      api = original ? base.configureTelemetry(sdk) : new BrowserTelemetry(sdk as any, sdk.capture),
      host = {
        platform: 'darwin',
        env: {},
        fetch: async (url: string, options: any) => {
          expect(options.signal).toBeInstanceOf(AbortSignal)
          calls.push(['fetch', url])
          return {
            ok: valid,
            json: async () => ({ object: 'user', id: 'id', email: 'user@example.com' })
          }
        }
      },
      reporter = {
        setUser: (user: any) => calls.push(['user', user]),
        setTag: (...args: any[]) => calls.push(['tag', ...args])
      }
    await api.initialize(host, reporter)
    let header, error
    try {
      header = await api.requestHeader()
    } catch (e: any) {
      error = e.message
    }
    await api.updateUser(host, reporter)
    api.setBackend(host, reporter, 'iab')
    api.logEvent(
      host,
      'action',
      'value',
      { secret: 'metadata' },
      { type: 'extension', family: 'chrome' }
    )
    return { calls, header, error }
  }
  for (const valid of [true, false])
    expect(await exercise(false, valid)).toEqual(await exercise(true, valid))
})
test('ambient-network-disabled telemetry leaves caller identity unavailable without requesting network', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const calls: any[] = [],
      sdk = { initialize: async () => calls.push('init'), capture: () => {} },
      api = original ? base.configureTelemetry(sdk) : new BrowserTelemetry(sdk as any),
      host = {
        env: { BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' },
        fetch: async () => {
          calls.push('fetch')
          throw Error('unexpected network')
        }
      },
      reporter = { setUser: () => calls.push('user'), setTag: () => calls.push('tag') }
    await api.initialize(host as any, reporter)
    let error
    try {
      await api.requestHeader()
    } catch (e: any) {
      error = e.message
    }
    return { calls, error }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
