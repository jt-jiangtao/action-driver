import { readdir } from 'node:fs/promises'
import { posix } from 'node:path'
import { createNativeMessagePipe } from './service-native-pipe.js'
import { enrichProfileInfo } from './service-profiles.js'
import { browserStatsig } from './service-statsig.js'
import type { NativeSocket } from './service-native-pipe.js'
import type { BackendApi, BackendBrowser, BackendInfo } from './service-context.js'
interface DiscoveryHost {
  platform: string
  env: Record<string, string | undefined>
  requestMeta?: Record<string, unknown> | undefined
  errorReporter?: { captureException(error: unknown): unknown }
  nativePipe?: { createConnection(path: string): Promise<NativeSocket> }
}
interface Capabilities {
  browser?: { id: string; description: string }[]
  tab?: { id: string; description: string }[]
}
interface DiscoveryInfo extends BackendInfo {
  capabilities?: Capabilities
  apiSupportOverrides?: Record<string, boolean>
  metadata?: {
    extensionInstanceId?: string
    codexSessionId?: string
    codexAppBuildFlavor?: string
    [key: string]: unknown
  }
}
interface DiscoveryApi extends BackendApi {
  getInfo(): Promise<DiscoveryInfo>
  close(): Promise<unknown>
}
interface Preferences {
  isFullCdpEnabled(): Promise<boolean>
  isWebMcpEnabled(): Promise<boolean>
}
interface DiscoveryBoundaries {
  captureException?: (error: unknown) => unknown
  logEvent?: (
    host: DiscoveryHost,
    name: string,
    value: string,
    metadata: Record<string, string>
  ) => unknown
  connect?: (path: string, host: DiscoveryHost) => Promise<unknown>
  enrichInfo?: (info: DiscoveryInfo, host: DiscoveryHost) => Promise<DiscoveryInfo>
  tinyskyEnabled?: (host: DiscoveryHost, info: DiscoveryInfo) => boolean
}
export function turnMetadata(
  host: Pick<DiscoveryHost, 'requestMeta'>
): Record<string, unknown> | undefined {
  let value = host.requestMeta?.['x-codex-turn-metadata']
  if (typeof value === 'string')
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
const trimmed = (host: DiscoveryHost, name: string) => host.env[name]?.trim() || undefined
export async function backendPaths(host: DiscoveryHost): Promise<string[]> {
  if (host.platform !== 'darwin')
    throw Error(`Unsupported browser backend platform: ${host.platform}`)
  const configured = host.env.BROWSER_USE_BACKEND_PATHS
  if (configured != null) {
    const values = configured.split(':').filter((value) => value !== '')
    if (values.some((value) => !posix.isAbsolute(value)))
      throw Error('BROWSER_USE_BACKEND_PATHS entries must be absolute')
    return [...new Set(values)]
  }
  return (await readdir('/tmp/codex-browser-use')).map((value) =>
    posix.resolve('/tmp/codex-browser-use', value)
  )
}
async function deadline<T>(request: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`Timed out after ${ms}ms waiting for browser backend info.`)),
          ms
        )
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
export function createBackendDiscovery(boundaries: DiscoveryBoundaries = {}) {
  let nextId = 1
  return async function discover(
    host: DiscoveryHost,
    createApi: (transport: unknown) => DiscoveryApi,
    previous: BackendBrowser[] = [],
    preferences?: Preferences
  ): Promise<BackendBrowser[]> {
    const metadata = turnMetadata(host),
      missing = ['session_id', 'turn_id'].filter((key) => typeof metadata?.[key] !== 'string')
    if (missing.length) throw Error(`Missing required Codex turn metadata: ${missing.join(', ')}`)
    const session =
      metadata?.thread_source === 'subagent' && typeof metadata.thread_id === 'string'
        ? metadata.thread_id
        : metadata?.session_id
    let paths: string[]
    let listingError: string | null = null
    try {
      paths = await backendPaths(host)
    } catch (error) {
      listingError = discoveryErrorText(error)
      paths = []
    }
    const listingPipeCount = paths.length
    const exact = trimmed(host, 'CDP_BROWSER_BACKEND_PIPE_PATH')
    if (trimmed(host, 'BROWSER_AUTH_EVAL_EXACT_CDP_BACKEND_SOCKET') === 'true' && exact != null)
      paths = paths.filter((path) => path === exact)
    const known = new Map(previous.map((browser) => [browser.pipe, browser]))
    const failures = new Map<string, string>()
    const capture =
      boundaries.captureException ??
      ((error: unknown) => host.errorReporter?.captureException(error))
    const found = await Promise.all(
      paths.map(async (path) => {
        const existing = known.get(path)
        if (existing) return existing
        let api: DiscoveryApi | undefined
        let phase = 'pipe-connect'
        try {
          api = createApi(
            await (boundaries.connect?.(path, host) ?? createNativeMessagePipe(path, host))
          )
          phase = 'backend-info-request'
          let info = await deadline(api.getInfo(), 5000)
          try {
            info = await (boundaries.enrichInfo ?? enrichProfileInfo)(info, host)
          } catch (error) {
            capture(error)
          }
          const cdpEligible =
            info.type === 'extension' ||
            info.type === 'iab' ||
            (host.env.BROWSER_USE_SECURITY_MODE?.trim() === 'gaas-browser-environment' &&
              host.env.BROWSER_USE_FULL_CDP_ACCESS_ENABLED === '1')
          if (cdpEligible && preferences && (await preferences.isFullCdpEnabled())) {
            const capabilities = info.capabilities?.tab ?? []
            if (!capabilities.some((value) => value.id === 'cdp'))
              info = {
                ...info,
                capabilities: {
                  ...info.capabilities,
                  tab: [
                    ...capabilities,
                    {
                      id: 'cdp',
                      description:
                        'Send raw Chrome DevTools Protocol commands and read debugger events through a supported tab for developer use cases.'
                    }
                  ]
                }
              }
          }
          if (
            preferences &&
            !(await preferences.isWebMcpEnabled()) &&
            info.capabilities?.tab?.some((value) => value.id === 'webmcp')
          )
            info = {
              ...info,
              capabilities: {
                ...info.capabilities,
                tab: info.capabilities.tab.filter((value) => value.id !== 'webmcp')
              }
            }
          const override = trimmed(host, 'BROWSER_USE_TINYSKY_ENABLED'),
            enabled =
              override != null
                ? override === '1'
                : info.type === 'cdp'
                  ? host.env.BROWSER_USE_ENABLE_TINYSKY_ACCESSIBILITY === '1'
                  : (boundaries.tinyskyEnabled?.(host, info) ??
                    browserStatsig.checkGate(host, 'codex-browser-use-tinysky', {
                      enabledByDefault: false
                    }))
          if (enabled || info.apiSupportOverrides?.['Tab.ax'] === true)
            info = {
              ...info,
              apiSupportOverrides: {
                ...info.apiSupportOverrides,
                'Tab.ax': enabled,
                ...(enabled ? { 'Tab.cua': false, 'Tab.dom_cua': false } : {})
              }
            }
          return { id: String(nextId++), pipe: path, api, info }
        } catch (error) {
          await api?.close()
          capture(error)
          failures.set(path, `${phase}/${discoveryErrorText(error)}`)
          return null
        }
      })
    )
    const available = new Set(paths)
    await Promise.all(
      previous
        .filter((browser) => !available.has(browser.pipe ?? ''))
        .map((browser) => browser.api.close())
    )
    const discovered = found.filter((browser): browser is BackendBrowser => browser !== null),
      flavor = trimmed(host, 'BROWSER_USE_CODEX_APP_BUILD_FLAVOR')
    const belongs = (browser: BackendBrowser) =>
      browser.info.type !== 'iab' ||
      (session != null &&
        browser.info.metadata?.codexSessionId === session &&
        (flavor == null || browser.info.metadata?.codexAppBuildFlavor === flavor))
    await Promise.all(
      discovered.filter((browser) => !belongs(browser)).map((browser) => browser.api.close())
    )
    const sessionBrowsers = [
      ...discovered.filter((browser) => browser.info.type !== 'iab'),
      ...discovered.filter((browser) => browser.info.type === 'iab' && belongs(browser))
    ]
    const configured = host.env.BROWSER_USE_AVAILABLE_BACKENDS,
      allowed =
        configured == null
          ? null
          : configured
              .split(',')
              .map((value) => value.trim())
              .filter((value) => ['chrome', 'iab', 'cdp'].includes(value)),
      permitted = (browser: BackendBrowser) =>
        allowed == null ||
        allowed.includes(browser.info.type === 'extension' ? 'chrome' : browser.info.type)
    await Promise.all(
      sessionBrowsers.filter((browser) => !permitted(browser)).map((browser) => browser.api.close())
    )
    const result = sessionBrowsers.filter(permitted)
    const iabCount = result.filter((browser) => browser.info.type === 'iab').length
    if (iabCount === 0) {
      const discoveredCount = discovered.filter((browser) => browser.info.type === 'iab').length
      const reason =
        session == null
          ? 'missing-session-metadata'
          : discoveredCount === 0
            ? 'no-iab-backends'
            : 'no-session-match'
      const failed = paths
        .flatMap((path) => (failures.has(path) ? [failures.get(path)!] : []))
        .slice(0, 8)
      const emit =
        boundaries.logEvent ??
        ((host, name, value, metadata) => browserStatsig.logEvent(host, name, value, metadata))
      emit(host, 'browser_use_backend_discovery_failed', reason, {
        backend: 'iab',
        browser_family: 'not_applicable',
        browserCount: String(result.length),
        candidatePipeCount: String(found.length),
        discoveredIabBrowserCount: String(discoveredCount),
        failureCount: String(failed.length),
        failures: JSON.stringify(failed),
        iabBrowserCount: String(iabCount),
        pipeListingError: listingError ?? 'none',
        pipeListingPipeCount: String(listingPipeCount),
        platform: host.platform,
        reason,
        release: '1.0.0'
      })
    }
    return result
  }
}

function discoveryErrorText(error: unknown) {
  if (typeof error === 'string') return error
  if (error == null || typeof error !== 'object') return String(error)
  const record = error as Record<string, unknown>
  const nonempty = (key: string) =>
    typeof record[key] === 'string' && record[key].length > 0 ? (record[key] as string) : null
  const name = nonempty('name'),
    message = nonempty('message')?.trim() ?? '',
    code = nonempty('code')
  const prefix = [name, code != null && !message.startsWith(`${code}:`) ? code : null]
    .filter((value) => value != null)
    .join(': ')
  return prefix ? (message ? `${prefix}: ${message}` : prefix) : message || String(error)
}
