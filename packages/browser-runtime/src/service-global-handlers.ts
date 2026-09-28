import type { BackendBrowser, BackendInfo } from './service-context.js'
import type { CapabilityInfo } from './capabilities.js'
import type { BrowserDocumentation, DocumentationBrowserInfo } from './service-documentation.js'
interface HandlerContext {
  refresh(): Promise<unknown>
  list(): Promise<BackendBrowser[]>
  get(id: string): Promise<BackendBrowser>
  getDefault(): Promise<BackendBrowser>
  getForUrl(url: string): Promise<BackendBrowser>
}
interface HandlerHost {
  env: Record<string, string | undefined>
}
interface Description extends DocumentationBrowserInfo {
  family: string | undefined
  profileName: unknown
  metadata: { extensionInstanceId: unknown; codexSessionId: unknown } | undefined
}
export function browserDescription(id: string, info: BackendInfo) {
  return {
    family: info.family,
    id,
    name: info.name as string,
    type: info.type,
    profileName: info.metadata?.profileName,
    metadata:
      info.metadata == null
        ? undefined
        : {
            extensionInstanceId: info.metadata.extensionInstanceId,
            codexSessionId: info.metadata.codexSessionId
          }
  }
}
export function browserDetails(host: HandlerHost, id: string, info: BackendInfo): Description {
  const source = info.capabilities as
      | { browser?: CapabilityInfo[]; tab?: CapabilityInfo[] }
      | undefined,
    filter = (surface: 'browser' | 'tab') => {
      const disabled = new Set(
        (
          host.env[
            surface === 'browser'
              ? 'BROWSER_USE_DISABLE_BROWSER_CAPABILITIES'
              : 'BROWSER_USE_DISABLE_TAB_CAPABILITIES'
          ] ?? ''
        )
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      )
      return (source?.[surface] ?? []).filter((item) => !disabled.has(item.id))
    },
    capabilities = { browser: filter('browser'), tab: filter('tab') },
    override = info.apiSupportOverrides as Record<string, boolean> | undefined
  return {
    ...browserDescription(id, info),
    apiSupportOverrides:
      info.type === 'cdp' && capabilities.tab.some((item) => item.id === 'browserAuth')
        ? { ...override, 'Tab.requestManualHandoff': true }
        : override,
    capabilities
  }
}
type Params = Record<string, string>
type Handler = (
  params: Params,
  context: HandlerContext,
  host: HandlerHost,
  docs: Pick<BrowserDocumentation, 'read' | 'readBrowser'>
) => Promise<unknown>
export const globalCommandHandlers: Record<string, Handler> = {
  async list_browsers(_params, context) {
    await context.refresh()
    return (await context.list()).map(({ id, info }) => browserDescription(id, info))
  },
  async get_browser(params, context, host) {
    await context.refresh()
    const browser = await context.get(params.id!)
    return browserDetails(host, browser.id, browser.info)
  },
  async get_default_browser(_params, context, host) {
    await context.refresh()
    const browser = await context.getDefault()
    return browserDetails(host, browser.id, browser.info)
  },
  async get_browser_for_url(params, context, host) {
    await context.refresh()
    const browser = await context.getForUrl(params.url!)
    return browserDetails(host, browser.id, browser.info)
  },
  async get_browser_documentation(params, context, host, docs) {
    const browser = await context.get(params.browser_id!)
    return docs.readBrowser(browserDetails(host, browser.id, browser.info))
  },
  async get_documentation(params, _context, _host, docs) {
    return docs.read(params.name!)
  }
}
