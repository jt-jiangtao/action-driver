import { browserStatsig } from './service-statsig.js'
import { securityMode } from './service-security-mode.js'
interface Host {
  platform: string
  env: Record<string, string | undefined>
  fetch(url: any, options: any): Promise<any>
  gaas?: { browserConfig: { user_id?: string } }
}
interface Reporter {
  setUser(user: unknown): unknown
  setTag(name: string, value: string): unknown
}
interface Identity extends Record<string, unknown> {
  id: string
  email?: string
}
interface Sdk {
  initialize(host: Host): Promise<unknown>
  setBackend(host: Host, backend: string): unknown
  updateUser(host: Host, user: Identity): Promise<unknown>
  logEvent(host: Host, name: string, value: unknown, metadata: Record<string, unknown>): unknown
  requestHeader(name: string): Promise<boolean>
}
const disabled = (host: Host) => host.env.BROWSER_USE_DISABLE_AMBIENT_NETWORK === '1'
export class BrowserTelemetry {
  private identity: Identity | null = null
  private identityPromise: Promise<void> | undefined
  constructor(
    private sdk: Sdk = browserStatsig,
    private capture: (error: unknown) => unknown = () => {}
  ) {}
  setReporter(report: (error: unknown) => unknown) {
    this.capture = report
  }
  private async readIdentity(host: Host) {
    if (this.identity != null) return this.identity
    const response = await host.fetch('https://chatgpt.com/backend-api/aura/identity', {
        signal: AbortSignal.timeout(10000)
      }),
      value = await response.json()
    if (
      !response.ok ||
      value?.object !== 'user' ||
      typeof value.id !== 'string' ||
      !value.id.trim()
    )
      throw Error('User unavailable')
    return (this.identity = value as Identity)
  }
  initialize(host: Host, reporter: Reporter) {
    if (disabled(host)) return
    if (securityMode(host) === 'gaas-browser-environment') this.setBackend(host, reporter, 'cdp')
    return Promise.all([this.sdk.initialize(host), this.updateUser(host, reporter)]).then(() => {})
  }
  setBackend(host: Host, reporter: Reporter, backend: string) {
    if (!disabled(host)) {
      reporter.setTag('backend', backend)
      this.sdk.setBackend(host, backend)
    }
  }
  updateUser(host: Host, reporter: Reporter) {
    if (disabled(host)) return
    this.identityPromise = (async () => {
      const identity = await this.readIdentity(host)
      reporter.setUser(identity)
      await this.sdk.updateUser(host, identity)
    })()
    return this.identityPromise.catch(this.capture)
  }
  logEvent(
    host: Host,
    name: string,
    value: unknown,
    metadata: Record<string, unknown>,
    backend?: { type: string; family?: string }
  ) {
    if (disabled(host)) return
    return this.sdk.logEvent(host, 'codex_' + name, value, {
      browser_family: 'not_applicable',
      ...(backend == null
        ? {}
        : {
            backend: backend.type,
            browser_family:
              backend.type === 'extension' ? (backend.family ?? 'unknown') : 'not_applicable'
          }),
      ...metadata
    })
  }
  async requestHeader() {
    if (this.identityPromise == null)
      throw Error('Browser request-header policy requires caller identity.')
    await this.identityPromise
    return await this.sdk.requestHeader('codex_browser_use_agent_request_header')
  }
}
export const browserTelemetry = new BrowserTelemetry()
