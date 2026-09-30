import type { BrowserDesktopHostSession, BrowserSessionCommand } from '@action-driver/browser-desktop'
import type { ProductBrowserHost } from '@action-driver/browser-runtime'
import { formatBrowserAXTree } from './ax-state.js'

type RemoteTab = { id: string; title: string; url: string }
function tabsFrom(value: unknown): RemoteTab[] {
  const list = (value as { tabs?: unknown })?.tabs
  if (!Array.isArray(list)) throw new Error('BROWSER_TABS_INVALID')
  return list.map((tab) => {
    if (!tab || typeof tab.id !== 'string' || typeof tab.title !== 'string' ||
        typeof tab.url !== 'string') throw new Error('BROWSER_TAB_INVALID')
    return tab as RemoteTab
  })
}

/** Maps the product session contract onto an Action-Driver-owned Chrome host. */
export function createExternalChromeHost(host: Pick<ProductBrowserHost, 'execute' | 'close'>):
  BrowserDesktopHostSession {
  let activeTabId: string | null = null
  let closed = false
  const assertOpen = () => { if (closed) throw new Error('BROWSER_HOST_CLOSED') }
  const command = (type: string, tabId?: string, extra: Record<string, unknown> = {}) =>
    host.execute({ type, browser_id: 'local', ...(tabId === undefined ? {} : { tab_id: tabId }), ...extra })
  const listTabs = async () => tabsFrom(await command('list_tabs'))
  const assertTab = async (tabId: string) => {
    if (!(await listTabs()).some((tab) => tab.id === tabId))
      throw new Error('BROWSER_TAB_UNAVAILABLE')
  }
  const history = async (tabId: string) => {
    const result = await command('tab_cdp_call', tabId, { method: 'Page.getNavigationHistory' }) as {
      currentIndex?: number; entries?: Array<{ id: number }>
    }
    return result?.entries && typeof result.currentIndex === 'number' ? result : null
  }
  return {
    async snapshot() {
      assertOpen()
      const tabs = await listTabs()
      if (!tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs[0]?.id ?? null
      return { activeTabId, tabs: await Promise.all(tabs.map(async (tab) => {
        const state = await history(tab.id).catch(() => null)
        return { ...tab, loading: false,
          canGoBack: Boolean(state && state.currentIndex! > 0),
          canGoForward: Boolean(state && state.currentIndex! < (state.entries?.length ?? 0) - 1) }
      })) }
    },
    async execute(tabId: string, action: BrowserSessionCommand) {
      assertOpen()
      await assertTab(tabId)
      switch (action.type) {
        case 'create-tab': {
          const result = await command('create_tab') as { id?: string }
          if (typeof result?.id !== 'string') throw new Error('BROWSER_TAB_INVALID')
          activeTabId = result.id
          return result.id
        }
        case 'select-tab': activeTabId = tabId; return undefined
        case 'close-tab': {
          await command('close_tab', tabId)
          if (activeTabId === tabId) activeTabId = null
          return undefined
        }
        case 'navigate':
          if (!/^https?:\/\//u.test(action.url)) throw new Error('BROWSER_URL_INVALID')
          return command('navigate_tab_url', tabId, { url: action.url })
        case 'back':
        case 'forward': {
          const state = await history(tabId)
          if (!state) throw new Error('BROWSER_HISTORY_UNAVAILABLE')
          const index = state.currentIndex! + (action.type === 'back' ? -1 : 1)
          const entry = state.entries?.[index]
          if (entry) await command('tab_cdp_call', tabId, {
            method: 'Page.navigateToHistoryEntry', params: { entryId: entry.id }
          })
          return undefined
        }
        case 'refresh': return command('tab_cdp_call', tabId, { method: 'Page.reload' })
        case 'click': return command('cua_click', tabId, { x: action.x, y: action.y,
          ...(action.button === undefined ? {} : { button: action.button }) })
        case 'double-click': return command('cua_double_click', tabId, { x: action.x, y: action.y })
        case 'move': return command('cua_move', tabId, { x: action.x, y: action.y })
        case 'drag': return command('cua_drag', tabId, { path: action.path })
        case 'keypress': return command('cua_keypress', tabId, { keys: action.keys })
        case 'type': return command('cua_type', tabId, { text: action.text })
        case 'scroll': return command('cua_scroll', tabId, { x: action.x, y: action.y,
          scroll_x: action.deltaX, scroll_y: action.deltaY })
        case 'screenshot': {
          const result = await command('tab_screenshot', tabId, {
            fullPage: action.fullPage,
            ...(action.clip ? { cropX: action.clip.x, cropY: action.clip.y,
              cropWidth: action.clip.width, cropHeight: action.clip.height } : {})
          }) as { data?: string }
          if (typeof result?.data !== 'string') throw new Error('BROWSER_SCREENSHOT_INVALID')
          return { mimeType: 'image/png', bytes: Buffer.from(result.data, 'base64') }
        }
        case 'ax-state': {
          const result = await command('tab_cdp_call', tabId,
            { method: 'Accessibility.getFullAXTree' }) as {
              nodes?: Parameters<typeof formatBrowserAXTree>[0]
            }
          return formatBrowserAXTree(result.nodes ?? [])
        }
      }
    },
    async close() {
      if (closed) return
      closed = true
      await host.close()
    }
  }
}
