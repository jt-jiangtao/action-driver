import { createRequire } from 'node:module'
import { securityMode } from './service-security-mode.js'
interface Client {
  loadingStatus: string
  initializeAsync(options: { timeoutMs: number }): Promise<{ success?: boolean }>
  updateUserAsync(
    user: Record<string, unknown>,
    options: { timeoutMs: number }
  ): Promise<{ success?: boolean }>
  checkGate(name: string): boolean
  getFeatureGate(name: string): { value: boolean; details: { reason: string } }
  getDynamicConfig(name: string): unknown
  logEvent(name: string, value: unknown, metadata: Record<string, unknown>): unknown
}
type Sdk = new (
  key: string,
  user: Record<string, unknown>,
  options: Record<string, unknown>
) => Client
interface Host {
  platform: string
  env: Record<string, string | undefined>
  fetch(url: any, options: any): Promise<any>
  gaas?: { browserConfig: { user_id?: string } }
}
interface State {
  client: Client
  user: Record<string, unknown> & { custom: Record<string, unknown> }
  browserClientBuild: string
  codexAppVersion: string | undefined
  initialized: boolean
  initialization?: Promise<{ success?: boolean }>
  ready?: Promise<{ success?: boolean }>
}
const require = createRequire(import.meta.url),
  trim = (value: string | undefined) => value?.trim() || undefined,
  timeoutMs = 10000
export class BrowserStatsig {
  private state: State | undefined
  constructor(
    private sdk: () => Sdk = () => require('@statsig/js-client').StatsigClient,
    private report: (error: unknown) => unknown = () => {}
  ) {}
  setReporter(report: (error: unknown) => unknown) {
    this.report = report
  }
  private get(host: Host): State {
    if (this.state != null) return this.state
    const appVersion = trim(host.env.BROWSER_USE_CODEX_APP_VERSION),
      build = trim(host.env.BROWSER_USE_BROWSER_CLIENT_BUILD) ?? '0.1.0',
      userID =
        securityMode(host) === 'gaas-browser-environment'
          ? trim(host.gaas?.browserConfig.user_id)
          : trim(host.env.NODE_REPL_SENTRY_USER_ID),
      user = {
        appVersion: build,
        userID,
        custom: {
          browserClientBuild: build,
          platform: host.platform,
          codexAppVersion: appVersion ?? '1.0.0'
        }
      }
    return (this.state = {
      client: new (this.sdk())('client-sYWqzCYMRkUg4DqqiZcR5DGTNl2iD7zNJY0HoeDLzxR', user, {
        environment: { tier: 'production' },
        networkConfig: {
          api: 'https://ab.chatgpt.com/v1',
          sdkExceptionUrl: 'https://ab.chatgpt.com/v1/sdk_exception',
          networkOverrideFunc: (url: any, options: any) => host.fetch(url, options)
        },
        loggingEnabled: 'always'
      }),
      user,
      browserClientBuild: build,
      codexAppVersion: appVersion,
      initialized: false
    })
  }
  private async values(state: State) {
    const deadline = performance.now() + timeoutMs,
      error = Error('Timed out waiting for Statsig values.')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error), timeoutMs)
      })
      while (performance.now() < deadline) {
        const current = state.ready,
          result = await Promise.race([current, timeout])
        if (current === state.ready) return result
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  async initialize(host: Host) {
    const state = this.get(host)
    try {
      if (state.initialization == null) {
        state.initialization = state.client.initializeAsync({ timeoutMs })
        state.ready = state.initialization
      }
      await state.initialization
      await this.values(state)
      state.initialized = true
    } catch (error) {
      console.warn(error)
      this.report(error)
    }
  }
  checkGate(
    host: Pick<Host, 'env'>,
    name: string,
    { enabledByDefault = false }: { enabledByDefault?: boolean } = {}
  ) {
    const state = this.state
    return (
      state != null &&
      host.env.BROWSER_USE_DISABLE_AMBIENT_NETWORK !== '1' &&
      state.initialized &&
      (enabledByDefault || state.client.checkGate(name))
    )
  }
  dynamicConfig(name: string) {
    return this.state?.initialized ? this.state.client.getDynamicConfig(name) : undefined
  }
  logEvent(_host: unknown, name: string, value: unknown, metadata: Record<string, unknown>) {
    const state = this.state
    if (state != null)
      return state.client.logEvent(name, value, {
        ...metadata,
        browserClientBuild: state.browserClientBuild,
        codexAppVersion: state.codexAppVersion ?? '1.0.0'
      })
  }
  setBackend(host: Host, backend: string) {
    const state = this.get(host)
    if (state.user.custom.backend !== backend) {
      state.user = { ...state.user, custom: { ...state.user.custom, backend } }
      void this.update(state).catch(this.report)
    }
  }
  private update(state: State) {
    state.ready = state.client.updateUserAsync(state.user, { timeoutMs })
    return state.ready
  }
  async updateUser(host: Host, { email, id }: { email?: string; id: string }) {
    const state = this.get(host)
    if (state.user.userID === id && state.user.email === email) {
      const ready = state.ready
      if ((await ready)?.success || state.ready !== ready) return state.ready
    }
    state.user = { ...state.user, email, userID: id }
    return this.update(state)
  }
  async requestHeader(name: string) {
    const state = this.state
    if (state?.initialization == null)
      throw Error('Browser request-header policy requires Statsig initialization.')
    await state.initialization
    if (!(await this.values(state))?.success || state.client.loadingStatus !== 'Ready')
      throw Error('Unable to load browser request-header policy. Retry the browser command.')
    const gate = state.client.getFeatureGate(name)
    if (!gate.details.reason.endsWith(':Recognized'))
      throw Error('Browser request-header gate is unavailable. Check its Statsig configuration.')
    return gate.value
  }
}

export const browserStatsig = new BrowserStatsig()
