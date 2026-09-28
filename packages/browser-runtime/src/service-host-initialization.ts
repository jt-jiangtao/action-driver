import { platform, tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { createBrowserConfig } from './service-config.js'
import type { BrowserConfigHost } from './service-config.js'
import { BrowserPreferences } from './service-preferences.js'
import { createNativeBrowserContext } from './service-native-context.js'
import { turnMetadata } from './service-discovery.js'
import { CredentialRegistry } from './service-credential-state.js'
import { AuthBrokerChallenge, readNativeCredentialStatus } from './service-auth-broker.js'
import { captureSafetyRuntime } from './service-safety-precheck.js'
import { CommandTiming } from './service-command-timing.js'
import { PerformanceSpans } from './service-performance-spans.js'
import { BrowserErrorReporter } from './service-error-reporter.js'
import { browserStatsig } from './service-statsig.js'
import { browserTelemetry } from './service-telemetry.js'
import type { TurnHookHost, BrowserPreference } from './service-context.js'
import type { NativeSocket } from './service-native-pipe.js'
import type { PromptResult } from './service-permission-state.js'
export interface PrivilegedBrowserHost extends BrowserConfigHost, TurnHookHost {
  env: Record<string, string | undefined>
  requestMeta?: Record<string, unknown> | undefined
  gaasBrowserConfig?: { user_id?: string }
  createElicitation(
    params: Record<string, unknown>
  ): Promise<PromptResult & { meta?: Record<string, unknown> }>
  setResponseMeta(value: unknown): unknown
  fetch(url: any, options: any): Promise<any>
  nativePipe?: { createConnection(path: string): Promise<NativeSocket> }
}
interface Reporter {
  captureException(error: unknown, options?: unknown): unknown
  setUser(user: unknown): unknown
  setTag(name: string, value: string): unknown
}
interface HostOptions {
  platform?: string
  reporter?: (host: PrivilegedBrowserHost) => Reporter
  registry?: CredentialRegistry
}
export const browserFilesystem = {
  tmpDir: tmpdir(),
  mkdir,
  rm,
  readFile: (path: string) => readFile(path, 'utf8'),
  readBytes: (path: string) => readFile(path),
  writeFile
}
export function hostPreference(host: Pick<PrivilegedBrowserHost, 'env'>): BrowserPreference | null {
  const env = host.env,
    trim = (key: string) => env[key]?.trim() || undefined
  const extensionInstanceId =
    trim('BROWSER_USE_PREFERRED_EXTENSION_INSTANCE_ID') ??
    trim('BROWSER_USE_PREFERRED_CHROME_EXTENSION_INSTANCE_ID')
  if (extensionInstanceId == null) return null
  const preferredWindowId = Number(
    trim('BROWSER_USE_PREFERRED_WINDOW_ID') ?? trim('BROWSER_USE_PREFERRED_CHROME_WINDOW_ID')
  )
  return {
    extensionInstanceId,
    ...(Number.isSafeInteger(preferredWindowId) && preferredWindowId >= 0
      ? { preferredWindowId }
      : {})
  }
}
/** Capture privileged capabilities while retaining request metadata as a live host getter. */
export async function prepareBrowserHost(host: PrivilegedBrowserHost, options: HostOptions = {}) {
  const elicit = host.createElicitation.bind(host)
  const prepared = {
    ...host,
    platform: options.platform ?? platform(),
    setResponseMeta: host.setResponseMeta,
    get requestMeta() {
      return host.requestMeta
    },
    async createElicitation(params: Record<string, unknown>) {
      const { meta, ...result } = await elicit(params)
      return { ...result, _meta: result._meta ?? meta }
    }
  }
  let gaas:
    | {
        browserConfig: { user_id?: string }
        config: unknown
        getNativeCredentialObservationStatus?: (session: string) => Promise<boolean | undefined>
        getBrowserAuthBrokerChallenge?: (
          fields: unknown,
          params: unknown,
          settings: any
        ) => Promise<AuthBrokerChallenge>
      }
    | undefined
  if (host.env.BROWSER_USE_SECURITY_MODE?.trim() === 'gaas-browser-environment') {
    let config: unknown = {}
    try {
      config = JSON.parse(
        await browserFilesystem.readFile(
          host.env.BROWSER_USE_CONFIG_PATH?.trim() || '/home/oai/.config/gaas-browser/config.json'
        )
      )
    } catch {}
    gaas = {
      browserConfig: host.gaasBrowserConfig ?? {},
      config,
      ...(host.env.BROWSER_AUTH_BROKER_SOCKET_PATH?.trim()
        ? {
            getNativeCredentialObservationStatus: (session: string) =>
              readNativeCredentialStatus(prepared, session),
            getBrowserAuthBrokerChallenge: (fields: unknown, params: unknown, settings: any) =>
              AuthBrokerChallenge.create(prepared, fields, params, settings)
          }
        : {})
    }
  }
  const runtime = Object.assign(prepared, {
    ...(gaas == null ? {} : { gaas })
  }) as typeof prepared & { gaas?: NonNullable<typeof gaas> }
  const registry = options.registry ?? new CredentialRegistry(),
    metadata = turnMetadata(runtime)
  const session =
    metadata?.thread_source === 'subagent' && typeof metadata.thread_id === 'string'
      ? metadata.thread_id
      : typeof metadata?.session_id === 'string'
        ? metadata.session_id
        : undefined
  await registry.initializeBroker(runtime, session)
  return Object.assign(runtime, { credentialRegistry: registry })
}
const reporterFactory = new BrowserErrorReporter()
/** Assemble the trusted native context, not the unfinished command service registry. */
export async function initializeBrowserHost(
  host: PrivilegedBrowserHost | undefined = (globalThis as { nodeRepl?: PrivilegedBrowserHost })
    .nodeRepl,
  options: HostOptions = {}
) {
  if (host?.config == null) throw Error('Browser use requires privileged Node REPL capabilities')
  if ((options.platform ?? platform()) !== 'darwin')
    throw Error(`Unsupported browser backend platform: ${options.platform ?? platform()}`)
  const runtime = await prepareBrowserHost(host, options),
    wasm = runtime.env.BROWSER_USE_ACCESSIBILITY_CORE_WASM_PATH?.trim()
  if (wasm && !isAbsolute(wasm)) throw Error('Accessibility core WebAssembly path must be absolute')
  const releaseSafety = captureSafetyRuntime(runtime)
  try {
    const config = createBrowserConfig(host),
      preferences = new BrowserPreferences(config, runtime)
    const errorReporter = options.reporter?.(runtime) ?? reporterFactory.get(runtime)
    browserStatsig.setReporter(errorReporter.captureException.bind(errorReporter))
    browserTelemetry.setReporter(errorReporter.captureException.bind(errorReporter))
    const browserContext = createNativeBrowserContext(
      Object.assign(runtime, { errorReporter }),
      preferences,
      hostPreference(runtime)
    )
    let disposed = false
    return Object.assign(runtime, {
      config,
      browserContext,
      preferences,
      errorReporter,
      filesystem: browserFilesystem,
      commandTiming: new CommandTiming(),
      performanceSpan: new PerformanceSpans(),
      async dispose() {
        if (disposed) return
        disposed = true
        try {
          await browserContext.dispose()
        } finally {
          releaseSafety()
        }
      }
    })
  } catch (error) {
    releaseSafety()
    throw error
  }
}
