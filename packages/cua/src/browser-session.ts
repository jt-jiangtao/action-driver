import { getBrowserTabs, getState, type TabRecord, type BrowserRecord } from './discovery.js'
import { createSessionLifecycle, type SessionLifecycle } from './session-lifecycle.js'
import { parseTabMention, getMentionedBrowserId } from './tab-reference.js'
import type { SessionHost } from './computer-session.js'

export interface SessionTab {
  id: string
  goto(url: string): Promise<void>
  getAXState(options: { disableDiffing: boolean; emit: boolean }): Promise<string>
}
export interface SessionBrowser {
  browserId: string
  documentation(): Promise<string>
  nameSession?(name: string): Promise<void>
  capabilities: { get(id: string): Promise<{ set(value: boolean): Promise<void> }> }
  tabs: {
    list(): Promise<TabRecord[]>
    new: () => Promise<SessionTab>
    get(id: string): Promise<SessionTab>
  }
  user?: { openTabs?(): Promise<TabRecord[]>; claimTab?(tab: TabRecord): Promise<SessionTab> }
}
export interface SessionBrowserInfo extends BrowserRecord {
  type?: string
  metadata?: { extensionInstanceId?: string }
}
export interface SessionBrowsers {
  list(): Promise<SessionBrowserInfo[]>
  get(id: string): Promise<SessionBrowser>
  getDefault?(): Promise<SessionBrowser>
  getForUrl?(url: string): Promise<SessionBrowser>
}
interface SelectOptions {
  browser?: string
  emit?: boolean
}
/** Browser-only CUA facade over an injected agent; default/combined runtime assembly is pending. */
export async function createBrowserSession({
  agent,
  getHost = () => (globalThis as typeof globalThis & { nodeRepl?: SessionHost }).nodeRepl,
  lifecycle = createSessionLifecycle(getHost)
}: {
  agent: { browsers: SessionBrowsers }
  getHost?: () => SessionHost | undefined
  lifecycle?: SessionLifecycle
}) {
  const browsers = agent.browsers
  const { browserDocs, emit, rewriteDocumentation } = lifecycle
  async function select(options?: SelectOptions, url?: string) {
    let browser: SessionBrowser
    if (options?.browser !== undefined) browser = await browsers.get(options.browser)
    else if (url !== undefined && browsers.getForUrl !== undefined)
      browser = await browsers.getForUrl(url)
    else if (browsers.getDefault !== undefined) browser = await browsers.getDefault()
    else {
      const first = (await browsers.list())[0]
      if (first === undefined) throw new Error('No browser is available.')
      browser = await browsers.get(first.id)
    }
    if (getHost()?.write !== undefined) {
      let pending = browserDocs.get(browser.browserId)
      if (pending === undefined) {
        pending = browser.documentation().catch((error) => {
          browserDocs.delete(browser.browserId)
          throw error
        })
        browserDocs.set(browser.browserId, pending)
      }
      await pending
    }
    return browser
  }
  async function observe(tab: SessionTab, browser: SessionBrowser) {
    const state = await tab.getAXState({ disableDiffing: true, emit: false })
    await emit(state, { browser })
    return tab
  }
  async function matchTabs(
    browser: SessionBrowser,
    controlled: TabRecord[],
    predicate: (tab: TabRecord) => boolean
  ) {
    const matches = controlled.filter(predicate)
    if (matches.length) return matches
    const user = (await browser.user?.openTabs?.()) ?? []
    const providers = new Map(user.map((tab) => [tab.id, tab.providerTabId]))
    const merged = new Map(
      [
        ...user,
        ...controlled.map((tab) => ({
          ...tab,
          providerTabId: tab.providerTabId ?? providers.get(tab.id)
        }))
      ].map((tab) => [tab.id, tab])
    )
    return [...merged.values()].filter(predicate)
  }
  const normalizeUrl = (url?: string) =>
    url === undefined || URL.canParse(url) ? url : `https://${url}`
  await emit()
  Reflect.set(globalThis, 'agent', agent)
  return {
    rewriteDocumentation,
    async getState(options?: { emit?: boolean }) {
      const state = await getState({ browsers })
      await emit(state, options)
      return state
    },
    browsers,
    async getBrowser(options?: { id?: string; extensionInstanceId?: string; url?: string }) {
      let id = options?.id
      if (options?.extensionInstanceId !== undefined) {
        if (id !== undefined) throw new Error('Specify either id or extensionInstanceId, not both.')
        const matches = (await browsers.list()).filter(
          (browser) =>
            browser.type === 'extension' &&
            browser.metadata?.extensionInstanceId === options.extensionInstanceId
        )
        if (matches.length === 0) throw new Error('The Chrome instance is unavailable.')
        if (matches.length !== 1)
          throw new Error(`Multiple browsers match the Chrome instance: ${JSON.stringify(matches)}`)
        id = matches[0]!.id
      }
      const browser = await select(
        { ...(id === undefined ? {} : { browser: id }) },
        normalizeUrl(options?.url)
      )
      await emit(undefined, { browser })
      return browser
    },
    async createBrowserTab(
      browserId: string,
      url?: string,
      options?: { sessionName?: string; visible?: boolean }
    ) {
      if (typeof browserId !== 'string' || browserId.trim() === '')
        throw new Error('createBrowserTab requires a browser ID. Select one with cua.getBrowser().')
      const normalized = normalizeUrl(url),
        browser = await select({ browser: browserId })
      if (options?.sessionName !== undefined) {
        if (typeof browser.nameSession !== 'function')
          throw new Error(`Browser ${browser.browserId} does not support sessionName.`)
        await browser.nameSession(options.sessionName)
      }
      if (options?.visible !== undefined)
        await (await browser.capabilities.get('visibility')).set(options.visible)
      const tab = await browser.tabs.new()
      if (normalized !== undefined) await tab.goto(normalized)
      return observe(tab, browser)
    },
    async getTab(
      reference: string | { mention: string } | { url: string },
      options?: SelectOptions
    ) {
      let browser: SessionBrowser, controlled: TabRecord[], matches: TabRecord[]
      if (typeof reference === 'string') {
        if (reference === '') throw new Error('getTab requires a tab reference')
        browser = await select(options)
        controlled = await browser.tabs.list()
        matches = await matchTabs(
          browser,
          controlled,
          (tab) => tab.id === reference || tab.providerTabId === reference
        )
      } else if ('mention' in reference) {
        const mention = parseTabMention(reference.mention)
        browser = await select({ browser: await getMentionedBrowserId(browsers, mention) })
        if (
          options?.browser !== undefined &&
          (await browsers.get(options.browser)).browserId !== browser.browserId
        ) {
          throw new Error("The requested browser does not match the tab mention's browser/profile.")
        }
        controlled = await browser.tabs.list()
        matches = await matchTabs(
          browser,
          controlled,
          (tab) => tab.providerTabId === mention.tab_id
        )
        const first = matches[0]
        if (first !== undefined && (first.title !== mention.title || first.url !== mention.url))
          throw new Error("Stale tab mention: the tab's title or URL has changed.")
      } else {
        if (!URL.canParse(reference.url)) throw new Error('getTab requires an absolute URL.')
        if (!options?.browser) throw new Error('getTab({ url }) requires an explicit browser.')
        browser = await select(options)
        controlled = await browser.tabs.list()
        const user = (await browser.user?.openTabs?.()) ?? []
        matches = [
          ...new Map([...user, ...controlled].map((tab) => [tab.id, tab])).values()
        ].filter((tab) => tab.url === reference.url)
      }
      const first = matches[0]
      if (first === undefined) throw new Error(`Tab not found in browser ${browser.browserId}.`)
      if (matches.length !== 1)
        throw new Error(
          `Multiple tabs match the reference in browser ${browser.browserId}: ${JSON.stringify(matches.map((tab) => ({ ...tab, browserId: browser.browserId })))}`
        )
      let tab: SessionTab
      if (controlled.some((tab) => tab.id === first.id)) tab = await browser.tabs.get(first.id)
      else {
        if (browser.user?.claimTab === undefined)
          throw new Error(`Tab ${first.id} cannot be claimed in browser ${browser.browserId}.`)
        tab = await browser.user.claimTab(first)
      }
      return observe(tab, browser)
    },
    async listBrowsers(options?: { emit?: boolean }) {
      const list = await browsers.list()
      await emit(list, options)
      return list
    },
    async listTabs(options?: SelectOptions) {
      let browser: SessionBrowser | undefined
      const list =
        options?.browser !== undefined
          ? ((browser = await select(options)), [{ id: browser.browserId }])
          : await browsers.list()
      const tabs = (
        await Promise.all(
          list.map(async (info) => {
            const selected = browser ?? (await browsers.get(info.id))
            return (await getBrowserTabs(selected)).map((tab) => ({
              ...tab,
              browserId: selected.browserId
            }))
          })
        )
      ).flat()
      await emit(tabs, { ...options, browser })
      return tabs
    }
  }
}
