import { captureTabScreenshot } from './service-screenshot.js'
import { browserTelemetry } from './service-telemetry.js'
import type { CredentialRegistry } from './service-credential-state.js'
import type { BrowserCdp } from './service-cdp.js'
import type { ServiceTab } from './service-tabs.js'
interface Host {
  platform: string
  env: Record<string, string | undefined>
  fetch(url: any, options: any): Promise<any>
  credentialRegistry?: CredentialRegistry
}
interface Context {
  browserId: string
  clientInfo: { type: string; family?: string; metadata?: { extensionInstanceId?: string } }
  cdp: Pick<BrowserCdp, 'call' | 'waitForEvent' | 'withInternalScreencast'>
  tabs: { list(): Promise<ServiceTab[]>; getActive(): Promise<ServiceTab> }
  credentialObservationGate?: {
    usedNativeCredentials: boolean
    observe<T>(run: () => Promise<T>, id: number): Promise<T>
  }
}
interface Telemetry {
  logEvent(
    host: Host,
    name: string,
    value: unknown,
    metadata: Record<string, unknown>,
    backend: Context['clientInfo']
  ): unknown
}
export function publicHttpUrl(input: unknown) {
  if (typeof input !== 'string') return undefined
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) ? url : undefined
  } catch {
    return undefined
  }
}
export function sanitizedUrl(input: unknown) {
  const url = publicHttpUrl(input)
  if (url == null) return undefined
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href
}
export function surfaceMetadata(input: {
  backend: string
  cloudBrowserHandoff?: Record<string, unknown> | undefined
  currentUrl?: unknown
  params: Record<string, unknown>
  surfaceDetails: Record<string, unknown>
}) {
  const url = sanitizedUrl(input.currentUrl) ?? sanitizedUrl(input.params.url)
  return {
    'codex/toolSurface': { kind: 'browserUse', backend: input.backend, ...input.surfaceDetails },
    browser_use: url != null ? { url } : {},
    ...(input.cloudBrowserHandoff == null
      ? {}
      : { cloud_browser_handoff: { ...input.cloudBrowserHandoff } })
  }
}
export function setBrowserResponseMetadata(
  host: { setResponseMeta(value: Record<string, unknown>): unknown },
  backend: string,
  details: Record<string, unknown>
) {
  const surface: Record<string, unknown> = {}
  for (const key of [
    'browserId',
    'browserFamily',
    'extensionInstanceId',
    'manualHandoffTabId',
    'openTabIds',
    'openTabs',
    'sessionEnded',
    'screenshot',
    'webMcpCalls'
  ])
    if (details[key] != null) surface[key] = details[key]
  host.setResponseMeta({
    'codex/browserUse': true,
    ...surfaceMetadata({
      backend,
      cloudBrowserHandoff: details.cloudBrowserHandoff as Record<string, unknown> | undefined,
      currentUrl: details.currentUrl,
      params: (details.params as Record<string, unknown>) ?? {},
      surfaceDetails: surface
    })
  })
}
function observationAllowed(context: Context, host: Host) {
  const registry = host.credentialRegistry
  return (
    registry?.isUnsafe() !== true &&
    context.credentialObservationGate?.usedNativeCredentials !== true &&
    (registry?.gates().every((gate) => !gate.usedNativeCredentials) ?? true)
  )
}
const tabId = (value: unknown) => {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : undefined
}
export async function collectBrowserResponseMetadata(
  input: {
    backend: string
    commandSucceeded: boolean
    commandType: string
    context: Context
    params: Record<string, unknown>
    result: unknown
    runtime: Host
  },
  telemetry: Telemetry = browserTelemetry
) {
  const { backend, context, params, result, runtime, commandType } = input,
    base = { browserId: context.browserId, browserFamily: context.clientInfo.family },
    details: Record<string, unknown> = { ...base }
  if (!observationAllowed(context, runtime)) return details
  const instance = context.clientInfo.metadata?.extensionInstanceId
  if (backend === 'chrome' && instance) details.extensionInstanceId = instance
  let tabs: ServiceTab[] = [],
    controlled: ServiceTab[] = [],
    active: ServiceTab | undefined
  const report = (error: unknown, phase: string, name: string) =>
    telemetry.logEvent(
      runtime,
      name,
      error instanceof Error ? error.name || 'Error' : typeof error,
      { backend, commandType, phase },
      context.clientInfo
    )
  try {
    tabs = await context.tabs.list()
    controlled = tabs.filter((tab) => tab.sessionControlled !== false)
    details.openTabIds = controlled.map((tab) => String(tab.id))
    if (backend === 'chrome')
      details.openTabs = controlled.map((tab) => ({
        faviconUrl: sanitizedUrl(tab.faviconUrl),
        id: tab.id,
        title: tab.title?.trim() || undefined,
        url: publicHttpUrl(tab.url)?.origin
      }))
    active = controlled.find((tab) => tab.active)
  } catch (error) {
    report(error, 'response-meta-tabs', 'browser_use_response_meta_tabs_failed')
  }
  if (!observationAllowed(context, runtime)) return details
  try {
    const returned =
      typeof result === 'object' && result != null ? Reflect.get(result, 'id') : undefined
    let id = tabId(params.tab_id) ?? tabId(returned)
    if (input.commandSucceeded && commandType === 'close_tab') id = undefined
    if (backend === 'iab') {
      active = id == null ? (active ?? controlled[0]) : controlled.find((tab) => tab.id === id)
      if (active == null) return observationAllowed(context, runtime) ? details : base
      id = active.id
    } else if (id == null) {
      active ??= await context.tabs.getActive()
      id = active.id
    }
    const screenshot = await captureTabScreenshot({ tab_id: String(id) }, context, 'device'),
      url = publicHttpUrl(
        tabs.find((tab) => tab.id === id)?.url ?? (active?.id === id ? active.url : undefined)
      ),
      pageUrl = url == null ? undefined : `${url.protocol}//${url.hostname}`
    details.screenshot = {
      tabId: String(id),
      url: `data:image/jpeg;base64,${screenshot.data}`,
      ...(pageUrl == null ? {} : { pageUrl })
    }
  } catch (error) {
    report(error, 'response-meta-screenshot', 'browser_use_response_meta_screenshot_failed')
  }
  return observationAllowed(context, runtime) ? details : base
}
