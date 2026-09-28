// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserErrorReporter } from '../src/service-error-reporter'
import { originalDocumentation } from './original-service'
test('error reporter initializes once with captured host transport and explicit privacy defaults', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const calls: any[] = [],
      sdk = {
        init: (options: any) => {
          calls.push(['init', { ...options, transport: 'transport' }])
          const transport = options.transport({
            url: 'https://errors.test/envelope',
            headers: { header: 'value' },
            keepAlive: true
          })
          return transport
        },
        createTransport: (_options: any, send: any) => {
          calls.push(['transport'])
          return send({ body: 'envelope' }).then((result: any) => calls.push(['response', result]))
        },
        setUser: (value: any) => calls.push(['user', value]),
        setTag: (...args: any[]) => calls.push(['tag', ...args]),
        captureException: (...args: any[]) => calls.push(['error', ...args])
      },
      host = {
        env: { NODE_REPL_SENTRY_USER_ID: ' user ' },
        fetch: async (...args: any[]) => {
          calls.push(['fetch', ...args])
          return {
            status: 200,
            headers: new Map([
              ['X-Sentry-Rate-Limits', 'limit'],
              ['Retry-After', 'retry']
            ])
          }
        }
      },
      factory = original
        ? base.configureErrorSdk(sdk)
        : new BrowserErrorReporter(() => sdk).get.bind(new BrowserErrorReporter(() => sdk))
    const reporter = factory(host)
    factory(host)
    reporter.setTag('key', 'value')
    reporter.captureException('failed', { tags: { method: 'CDP' } })
    reporter.setUser({ id: 'updated' })
    await new Promise((resolve) => setImmediate(resolve))
    return calls
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('ambient network disable skips SDK initialization but returns SDK reporting facade', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const calls: any[] = [],
      sdk = {
        init: () => calls.push('init'),
        captureException: (...args: any[]) => calls.push(['capture', ...args]),
        setUser: () => {},
        setTag: () => {},
        createTransport: () => {}
      }
    const factory = original
      ? base.configureErrorSdk(sdk)
      : new BrowserErrorReporter(() => sdk).get.bind(new BrowserErrorReporter(() => sdk))
    const reporter = factory({ env: { BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1' } })
    reporter.captureException('error')
    return calls
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
