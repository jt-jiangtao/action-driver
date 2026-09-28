import { BrowserContext } from './service-context.js'
import type { BrowserPreference, TurnHookHost } from './service-context.js'
import { createBackendDiscovery, turnMetadata } from './service-discovery.js'
import { SessionBrowserApi } from './service-backend-api.js'
import { browserTelemetry } from './service-telemetry.js'
import type { NativeSocket } from './service-native-pipe.js'
import type { MessageTransport } from './service-rpc.js'
export interface NativeContextHost extends TurnHookHost {
  platform: string
  env: Record<string, string | undefined>
  requestMeta?: Record<string, unknown> | undefined
  nativePipe?: { createConnection(path: string): Promise<NativeSocket> }
  errorReporter?: { captureException(error: unknown): unknown }
}
interface ContextPreferences {
  isFullCdpEnabled(): Promise<boolean>
  isWebMcpEnabled(): Promise<boolean>
}
/** Concrete transport and session API assembly; does not create a command backend or service entry. */
export function createNativeBrowserContext<Host extends NativeContextHost>(
  host: Host,
  preferences: ContextPreferences,
  preference: BrowserPreference | null = null
) {
  if (host.platform !== 'darwin')
    throw Error(`Unsupported browser backend platform: ${host.platform}`)
  const discover = createBackendDiscovery()
  let context: BrowserContext<Host>
  const createApi = (transport: unknown) =>
    new SessionBrowserApi(
      transport as MessageTransport,
      context.clientApi,
      () => turnMetadata(host),
      context.turnEndedTracker,
      () => browserTelemetry.requestHeader()
    )
  context = new BrowserContext(
    host,
    preference,
    preferences,
    (runtime, _createApi, previous) => discover(runtime, createApi, previous, preferences),
    createApi
  )
  return context
}
