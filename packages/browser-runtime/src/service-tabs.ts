export interface ServiceTab {
  id: number
  title?: string
  url?: string
  active?: boolean
  [key: string]: unknown
}
interface TabsApi {
  createTab(window?: number): Promise<unknown>
  getTabs(): Promise<ServiceTab[]>
  markTab(id: number, mark: unknown): Promise<unknown>
}
export class ServiceTabs {
  constructor(
    private api: TabsApi,
    private preferredWindowId?: number
  ) {}
  async create() {
    return await this.api.createTab(this.preferredWindowId)
  }
  async list() {
    return await this.api.getTabs()
  }
  async mark(id: number, mark: unknown) {
    await this.api.markTab(id, mark)
  }
  async get(id: number) {
    const tabs = await this.list(),
      tab = tabs.find((tab) => tab.id === id)
    if (tab === undefined) {
      const available = tabs.length
        ? tabs
            .map((tab) => `${tab.id}|${tab.title ?? '<no title>'}|${tab.url ?? '<no url>'}`)
            .join(', ')
        : 'none'
      throw Error(`Tab not found: ${id}. Existing tabs: ${available}`)
    }
    return tab
  }
  async getActive() {
    const tab = (await this.list()).find((tab) => tab.active)
    if (tab === undefined) throw Error('No active tab found')
    return tab
  }
}
interface MouseApi {
  moveMouse(params: {
    tabId: number
    x: number
    y: number
    waitForArrival?: false
  }): Promise<unknown>
}
export class BrowserUi {
  constructor(private api: MouseApi) {}
  async moveMouse(tabId: number, x: number, y: number, options: { waitForArrival?: boolean } = {}) {
    try {
      const moved = this.api.moveMouse({
        tabId,
        ...(options.waitForArrival === false ? { waitForArrival: false as const } : {}),
        x,
        y
      })
      if (options.waitForArrival === false) {
        void moved.catch(() => {})
        return
      }
      await moved
    } catch {}
  }
}
