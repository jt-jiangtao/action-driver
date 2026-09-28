import { createRequire } from 'node:module'
import { securityMode } from './service-security-mode.js'
interface EnvelopeRequest {
  body: unknown
}
interface TransportOptions {
  url: string
  headers: unknown
  keepAlive?: boolean
}
interface ErrorSdk {
  init(options: Record<string, unknown>): unknown
  captureException(error: unknown, options?: unknown): unknown
  setUser(user: unknown): unknown
  setTag(name: string, value: string): unknown
  createTransport(
    options: TransportOptions,
    send: (request: EnvelopeRequest) => Promise<unknown>
  ): unknown
}
interface ErrorHost {
  env: Record<string, string | undefined>
  gaas?: { browserConfig: { user_id?: string } }
  fetch(
    url: string,
    options: Record<string, unknown>
  ): Promise<{ status: number; headers: { get(name: string): string | null | undefined } }>
}
const require = createRequire(import.meta.url)
export class BrowserErrorReporter {
  private initialized = false
  constructor(private sdk: () => ErrorSdk = () => require('@sentry/node')) {}
  get(host: ErrorHost) {
    const sdk = this.sdk()
    if (!this.initialized && host.env.BROWSER_USE_DISABLE_AMBIENT_NETWORK !== '1') {
      sdk.init({
        dsn: 'https://946e373d0393408ec734c0156b0aeec6@o33249.ingest.us.sentry.io/4511236780326912',
        sendDefaultPii: false,
        environment: 'production',
        release: '0.1.0',
        transport: (options: TransportOptions) =>
          sdk.createTransport(options, async (request) => {
            const response = await host.fetch(options.url, {
              body: request.body,
              method: 'POST',
              referrerPolicy: 'origin',
              headers: options.headers,
              keepalive: options.keepAlive
            })
            return {
              statusCode: response.status,
              headers: {
                'x-sentry-rate-limits': response.headers.get('X-Sentry-Rate-Limits'),
                'retry-after': response.headers.get('Retry-After')
              }
            }
          })
      })
      const id =
        (securityMode(host) === 'gaas-browser-environment'
          ? host.gaas?.browserConfig.user_id
          : host.env.NODE_REPL_SENTRY_USER_ID
        )?.trim() || undefined
      if (id != null) sdk.setUser({ id })
      this.initialized = true
    }
    return {
      captureException: (error: unknown, options?: unknown) => {
        sdk.captureException(error, options)
      },
      setUser: (user: unknown) => {
        sdk.setUser(user)
      },
      setTag: (name: string, value: string) => {
        sdk.setTag(name, value)
      }
    }
  }
}
