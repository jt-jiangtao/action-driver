import type { ServiceTab } from './service-tabs.js'
import type { BrowserCdp } from './service-cdp.js'
interface TabContext {
  tabs: {
    create(): Promise<unknown>
    get(id: number): Promise<ServiceTab>
    list(): Promise<ServiceTab[]>
    getActive(): Promise<ServiceTab>
    mark(id: number, status: unknown): Promise<unknown>
  }
  cdp: Pick<BrowserCdp, 'closeTab' | 'call' | 'waitForPageLoadEvent'>
  tabLifecycle: { recordCreated(id: number): unknown; recordAcquired(id: number): unknown }
  credentialObservationGate?: { hasManualSavingTab(id: number): boolean }
  clientInfo?: { type?: string; family?: string }
  nameSession(name: string): Promise<unknown>
}
interface Params {
  tab_id?: number | string
  status?: unknown
  name?: string
  timeout_ms?: number
}
function id(input: Params, command?: string) {
  const value = Number(input.tab_id)
  if (!Number.isInteger(value) || value <= 0)
    throw Error(
      command ? `${command} requires a positive integer tab_id` : 'Expected a positive integer'
    )
  return value
}
function exposed(tab: ServiceTab, context: TabContext) {
  const hidden = context.credentialObservationGate?.hasManualSavingTab(tab.id) === true
  return {
    ...(tab.title == null || hidden ? {} : { title: tab.title }),
    ...(tab.url == null || hidden ? {} : { url: tab.url })
  }
}
async function history(params: Params, context: TabContext, direction: 'back' | 'forward') {
  const tabId = id(params, `navigate_tab_${direction}`),
    timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : 10000,
    history = (await context.cdp.call(tabId, 'Page.getNavigationHistory')) as {
      entries: { id: number }[]
      currentIndex: number
    },
    entry = history.entries[history.currentIndex + (direction === 'back' ? -1 : 1)]
  if (entry == null)
    throw Error(
      `Cannot navigate ${direction}: no ${direction === 'back' ? 'previous' : 'next'} page in history.`
    )
  const load = context.cdp.waitForPageLoadEvent(tabId, { timeoutMs })
  await context.cdp.call(tabId, 'Page.navigateToHistoryEntry', { entryId: entry.id })
  await load
  return {}
}
export const tabCommandHandlers = {
  close_tab: async (params: Params, context: TabContext) => {
    await context.cdp.closeTab(id(params, 'close_tab'))
    return {}
  },
  create_tab: async (_params: Params, context: TabContext) => {
    const tab = (await context.tabs.create()) as { id: number }
    context.tabLifecycle.recordCreated(tab.id)
    return { id: tab.id.toString() }
  },
  get_tab: async (params: Params, context: TabContext) => {
    const tab = await context.tabs.get(id(params))
    if (tab.sessionControlled !== false) context.tabLifecycle.recordAcquired(tab.id)
    return { id: String(tab.id), ...exposed(tab, context) }
  },
  list_tabs: async (_params: Params, context: TabContext) => ({
    tabs: (await context.tabs.list()).map((tab) => ({
      id: tab.id.toString(),
      providerTabId: tab.providerTabId,
      ...exposed(tab, context)
    }))
  }),
  mark_tab: async (params: Params, context: TabContext) => {
    try {
      await context.tabs.mark(id(params), params.status)
    } catch (error) {
      if (context.clientInfo?.type === 'extension') {
        const names: Record<string, string> = {
          chrome: 'Google Chrome',
          edge: 'Microsoft Edge',
          brave: 'Brave',
          opera: 'Opera',
          vivaldi: 'Vivaldi'
        }
        throw Error(
          `Please update the ChatGPT extension in ${names[context.clientInfo.family ?? 'chrome']} to the latest version to continue.`,
          { cause: error }
        )
      }
      throw error
    }
    return {}
  },
  name_session: async (params: Params, context: TabContext) => {
    const name = params.name!.trim()
    if (!name) throw Error('name_session requires a name')
    await context.nameSession(name)
    return {}
  },
  selected_tab: async (_params: Params, context: TabContext) => {
    try {
      const tab = await context.tabs.getActive()
      if (tab.sessionControlled !== false) context.tabLifecycle.recordAcquired(tab.id)
      return { id: tab.id.toString() }
    } catch {
      return {}
    }
  },
  navigate_tab_back: async (params: Params, context: TabContext) =>
    await history(params, context, 'back'),
  navigate_tab_forward: async (params: Params, context: TabContext) =>
    await history(params, context, 'forward'),
  navigate_tab_reload: async (params: Params, context: TabContext) => {
    const tabId = id(params, 'navigate_tab_reload'),
      load = context.cdp.waitForPageLoadEvent(tabId, {
        timeoutMs: typeof params.timeout_ms === 'number' ? params.timeout_ms : 10000
      })
    await context.cdp.call(tabId, 'Page.reload', {})
    await load
    return {}
  }
}
