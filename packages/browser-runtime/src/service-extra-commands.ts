interface Params {
  tab_id?: number | string
  expected_url?: string
  queries?: unknown
  limit?: unknown
  from?: unknown
  to?: unknown
  filter?: string
  levels?: string[]
  assetIds?: string[]
  inventoryId?: string
  kinds?: string[]
}
interface Context {
  browserUser: {
    claimTab(id: number): Promise<any>
    getTabContext(id: number, expectedUrl: string): Promise<unknown>
    openTabs(): Promise<any[]>
  }
  tabLifecycle: { recordAcquired(id: number): unknown }
  history(options: object): Promise<any[]>
  dev: { logs(options: object): Promise<any[]> }
  tabs: { get(id: number): Promise<{ url?: string }> }
  pageAssets: {
    bundle(options: object): Promise<unknown>
    list(options: object): Promise<unknown>
  }
}
const tabId = (input: unknown) => {
  const id = Number(input)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return id
}
function historyOptions(params: Params) {
  const result: Record<string, unknown> = {}
  if (params.queries != null) {
    if (!Array.isArray(params.queries) || params.queries.length === 0 ||
      params.queries.some((value) => typeof value !== 'string'))
      throw Error('browser_user_history requires queries to be a non-empty array of strings')
    result.queries = params.queries
  }
  if (params.limit != null) {
    if (!Number.isInteger(params.limit) || Number(params.limit) <= 0)
      throw Error('browser_user_history requires limit to be a positive integer')
    result.limit = params.limit
  }
  for (const field of ['from', 'to'] as const) {
    const value = params[field]
    if (value != null) {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
        throw Error(`browser_user_history requires ${field} to be a valid date`)
      result[field] = value
    }
  }
  return result
}
/** Thin command-level projections over already reconstructed service components. */
export const extraCommandHandlers = {
  browser_user_claim_tab: async (params: Params, context: Context) => {
    const tab = await context.browserUser.claimTab(tabId(params.tab_id))
    context.tabLifecycle.recordAcquired(tab.id)
    return {
      id: String(tab.id),
      ...(tab.title == null ? {} : { title: tab.title }),
      ...(tab.url == null ? {} : { url: tab.url })
    }
  },
  browser_user_get_tab_context: async (params: Params, context: Context) => {
    if (params.expected_url == null) throw Error('Missing authorized user tab URL')
    return await context.browserUser.getTabContext(tabId(params.tab_id), params.expected_url)
  },
  browser_user_history: async (params: Params, context: Context) => ({
    items: (await context.history(historyOptions(params))).map((item) => ({
      url: item.url,
      ...(item.title == null ? {} : { title: item.title }),
      dateVisited: item.dateVisited
    }))
  }),
  browser_user_open_tabs: async (_params: Params, context: Context) => ({
    tabs: (await context.browserUser.openTabs()).map((tab) => ({
      id: String(tab.id),
      ...(tab.providerTabId == null ? {} : { providerTabId: tab.providerTabId }),
      ...(tab.title == null ? {} : { title: tab.title }),
      ...(tab.url == null ? {} : { url: tab.url }),
      ...(tab.lastOpened == null ? {} : { lastOpened: tab.lastOpened }),
      ...(tab.tabGroup == null ? {} : { tabGroup: tab.tabGroup })
    }))
  }),
  tab_dev_logs: async (params: Params, context: Context) => ({
    logs: (await context.dev.logs({
      tabId: tabId(params.tab_id),
      filter: params.filter,
      levels: params.levels,
      limit: params.limit
    })).map(({ level, message, timestamp, url }) => ({
      level, message, timestamp, ...(url == null ? {} : { url })
    }))
  }),
  tab_page_assets_bundle: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), tab = await context.tabs.get(id)
    return await context.pageAssets.bundle({
      assetIds: params.assetIds,
      documentUrl: tab.url,
      inventoryId: params.inventoryId,
      kinds: params.kinds,
      tabId: id
    })
  },
  tab_page_assets_list: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), tab = await context.tabs.get(id)
    return await context.pageAssets.list({ documentUrl: tab.url, tabId: id })
  }
}
