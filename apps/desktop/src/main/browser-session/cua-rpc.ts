import type { BrowserSessionCommand, BrowserSurface } from '@action-driver/browser-desktop'
import type { createTaskBrowserBinding } from './task-binding.js'

type Binding = ReturnType<typeof createTaskBrowserBinding>
type Command = Record<string, unknown>

const browsers = {
  iab: { id: 'iab', name: 'Action-Driver', type: 'iab', family: 'chrome',
    apiSupportOverrides: { 'Tab.ax': true }, capabilities: { browser: [], tab: [] } },
  chrome: { id: 'chrome', name: 'Action-Driver Chrome', type: 'cdp', family: 'chrome',
    apiSupportOverrides: { 'Tab.ax': true }, capabilities: { browser: [], tab: [] } }
} as const

function surface(id: unknown): BrowserSurface {
  if (id === 'iab') return 'embedded'
  if (id === 'chrome') return 'external-chrome'
  throw new Error('BROWSER_UNAVAILABLE')
}
function tabId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('BROWSER_TAB_REQUIRED')
  return value
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('BROWSER_COORDINATES_REQUIRED')
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('BROWSER_TEXT_REQUIRED')
  return value
}
function url(value: unknown): string {
  const raw = text(value)
  try {
    const parsed = new URL(raw)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !parsed.username && !parsed.password) return raw
  } catch { /* invalid URL */ }
  throw new Error('BROWSER_URL_INVALID')
}
function noModifiers(value: unknown): void {
  if (value !== undefined && (!Array.isArray(value) || value.length !== 0))
    throw new Error('BROWSER_KEY_COMBINATION_UNAVAILABLE')
}
function point(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== 'object') throw new Error('BROWSER_COORDINATES_REQUIRED')
  const item = value as Command
  return { x: finite(item.x), y: finite(item.y) }
}

/** Codex Browser/Tab commands are resolved inside the trusted task boundary. */
export function createTaskBrowserRpc(binding: Binding) {
  const ensure = async (taskId: string, browserId: unknown) => {
    if (!taskId) throw new Error('BROWSER_TASK_REQUIRED')
    const target = surface(browserId)
    return await binding.snapshot(taskId, target) ?? await binding.open(taskId, target)
  }
  const ownedTab = async (taskId: string, command: Command) => {
    const snapshot = await ensure(taskId, command.browser_id)
    const id = tabId(command.tab_id)
    const tab = snapshot.tabs.find((item) => item.id === id)
    if (!tab) throw new Error('BROWSER_TAB_UNAVAILABLE')
    return { snapshot, tab, id }
  }
  const execute = async (taskId: string, command: Command, action: BrowserSessionCommand) => {
    const { snapshot, id } = await ownedTab(taskId, command)
    return binding.execute(taskId, snapshot.sessionId, id, action, 'agent')
  }
  return async (taskId: string, command: Command): Promise<unknown> => {
    if (!taskId) throw new Error('BROWSER_TASK_REQUIRED')
    switch (command.type) {
      case 'close_task': {
        await binding.closeTask(taskId)
        return { closed: true }
      }
      case 'list_browsers': return Object.values(browsers)
      case 'get_browser': return browsers[command.id as keyof typeof browsers] ??
        surface(command.id)
      case 'get_default_browser': return browsers.iab
      case 'get_documentation': return {}
      case 'get_browser_documentation': {
        surface(command.browser_id)
        return 'Use browser.tabs.list(), browser.tabs.get(id), browser.tabs.new(), tab.goto(url), tab.getAXState(), tab.screenshot(), and tab.cua. Only Action-Driver-owned tabs are available.'
      }
      case 'get_browser_for_url': {
        for (const snapshot of await binding.snapshots(taskId))
          if (snapshot.tabs.some((tab) => tab.url === command.url))
            return snapshot.surface === 'embedded' ? browsers.iab : browsers.chrome
        throw new Error('BROWSER_URL_UNAVAILABLE')
      }
      case 'list_tabs':
      case 'browser_user_open_tabs':
        return { tabs: (await ensure(taskId, command.browser_id)).tabs }
      case 'selected_tab': {
        const snapshot = await ensure(taskId, command.browser_id)
        return snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? {}
      }
      case 'get_tab':
      case 'browser_user_claim_tab': return (await ownedTab(taskId, command)).tab
      case 'create_tab': {
        const snapshot = await ensure(taskId, command.browser_id)
        const anchor = snapshot.activeTabId ?? snapshot.tabs[0]?.id
        if (!anchor) throw new Error('BROWSER_TAB_UNAVAILABLE')
        const id = await binding.execute(taskId, snapshot.sessionId, anchor,
          { type: 'create-tab' }, 'agent')
        const updated = await binding.snapshot(taskId, snapshot.surface)
        const tab = updated?.tabs.find((item) => item.id === id)
        if (!tab) throw new Error('BROWSER_TAB_UNAVAILABLE')
        return tab
      }
      case 'close_tab': await execute(taskId, command, { type: 'close-tab' }); return {}
      case 'navigate_tab_url':
        await execute(taskId, command, { type: 'navigate', url: url(command.url) }); return {}
      case 'navigate_tab_back': await execute(taskId, command, { type: 'back' }); return {}
      case 'navigate_tab_forward': await execute(taskId, command, { type: 'forward' }); return {}
      case 'navigate_tab_reload': await execute(taskId, command, { type: 'refresh' }); return {}
      case 'cua_click':
        noModifiers(command.keys)
        if (command.button !== undefined && command.button !== 1 &&
            command.button !== 2 && command.button !== 3)
          throw new Error('BROWSER_MOUSE_BUTTON_UNAVAILABLE')
        await execute(taskId, command, { type: 'click', x: finite(command.x), y: finite(command.y),
          ...(command.button === undefined ? {} : { button: command.button }) })
        return {}
      case 'cua_double_click':
        noModifiers(command.keys)
        await execute(taskId, command, { type: 'double-click', ...point(command) }); return {}
      case 'cua_move':
        noModifiers(command.keys)
        await execute(taskId, command, { type: 'move', ...point(command) }); return {}
      case 'cua_drag': {
        noModifiers(command.keys)
        if (!Array.isArray(command.path) || command.path.length < 2)
          throw new Error('BROWSER_DRAG_PATH_REQUIRED')
        await execute(taskId, command, { type: 'drag', path: command.path.map(point) }); return {}
      }
      case 'cua_keypress': {
        if (!Array.isArray(command.keys) || command.keys.length !== 1 ||
            typeof command.keys[0] !== 'string')
          throw new Error('BROWSER_KEY_COMBINATION_UNAVAILABLE')
        await execute(taskId, command, { type: 'keypress', keys: [command.keys[0]] }); return {}
      }
      case 'cua_type':
        await execute(taskId, command, { type: 'type', text: text(command.text) }); return {}
      case 'cua_scroll':
        noModifiers(command.keys)
        await execute(taskId, command, { type: 'scroll', x: finite(command.x), y: finite(command.y),
          deltaX: finite(command.scroll_x), deltaY: finite(command.scroll_y) })
        return {}
      case 'tab_screenshot': {
        const crop = ['cropX', 'cropY', 'cropWidth', 'cropHeight']
          .some((name) => command[name] !== undefined)
        const clip = crop ? {
          x: command.cropX, y: command.cropY,
          width: command.cropWidth, height: command.cropHeight
        } : undefined
        if (clip && (Object.values(clip).some((value) =>
          typeof value !== 'number' || !Number.isFinite(value)) ||
          (clip.width as number) <= 0 || (clip.height as number) <= 0))
          throw new Error('BROWSER_SCREENSHOT_CLIP_INVALID')
        const result = await execute(taskId, command, { type: 'screenshot',
          fullPage: command.fullPage === true,
          ...(clip ? { clip: clip as { x: number; y: number; width: number; height: number } } : {})
        }) as {
          mimeType?: string; bytes?: Uint8Array
        }
        if (!(result?.bytes instanceof Uint8Array)) throw new Error('BROWSER_SCREENSHOT_INVALID')
        return { data: Buffer.from(result.bytes).toString('base64') }
      }
      case 'tab_ax_get_state': {
        if (command.content !== 'axState' && command.content !== 'axStateAndScreenshot' &&
            command.content !== 'screenshot')
          throw new Error('BROWSER_AX_CONTENT_UNAVAILABLE')
        const state = command.content === 'screenshot' ? undefined
          : await execute(taskId, command, { type: 'ax-state' })
        if (state !== undefined && typeof state !== 'string') throw new Error('BROWSER_AX_STATE_INVALID')
        if (command.content === 'axState') return { state }
        const screenshot = await execute(taskId, command, { type: 'screenshot' }) as {
          bytes?: Uint8Array
        }
        return { ...(state === undefined ? {} : { state }), ...(screenshot?.bytes instanceof Uint8Array
          ? { data: Buffer.from(screenshot.bytes).toString('base64') }
          : { screenshot_unavailable: 'Capture failed' }) }
      }
      default: throw new Error(`BROWSER_COMMAND_UNAVAILABLE: ${String(command.type)}`)
    }
  }
}
