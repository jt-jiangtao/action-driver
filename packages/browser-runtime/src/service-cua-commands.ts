import { DomCuaClick } from './commands/index.js'
import { clipboardShortcut } from './service-keyboard-input.js'
import { performVirtualClipboardShortcut } from './service-playwright-clipboard-shortcut.js'
import { pastePage, runClipboardPageAction } from './service-playwright-paste.js'
import type { CuaInput } from './service-cua-input.js'
import type { BrowserCdp } from './service-cdp.js'
import type { ServiceClipboard } from './service-clipboard.js'
import { VisibleDomSnapshot } from './service-visible-dom.js'
import { renderMarkdownRichText, richTextAllowed, richTextClipboardItems } from './service-rich-text.js'

interface Params {
  tab_id: number | string
  button?: number
  keys?: string[]
  node_id?: unknown
  path?: { x: number; y: number }[]
  scroll_x?: number
  scroll_y?: number
  timeout_ms?: number
  x?: number
  y?: number
  text?: unknown
  includeRichText?: boolean
  inputTargetToken?: string
  replaceInputValue?: boolean
  executionContextId?: number
  target?: { tabId: number; sessionId?: string; targetId?: string }
}
interface Context {
  cua: CuaInput
  cdp: BrowserCdp
  clipboard: ServiceClipboard
  runtime: { platform: string }
  visibleDom?: VisibleDomSnapshot
  tabs: { get(id: number): Promise<{ url?: string }> }
}
function tabId(value: number | string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return id
}
function point(command: string, value: { x?: number; y?: number }) {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y))
    throw Error(`${command} requires finite x and y coordinates`)
  return { x: value.x!, y: value.y! }
}
function modifiers(keys: string[] | undefined, platform: string) {
  let value = 0
  for (const key of keys ?? []) {
    const normalized = key === 'ControlOrMeta' ? (platform === 'darwin' ? 'Meta' : 'Control') : key
    value |= normalized === 'Alt' ? 1 : normalized === 'Control' ? 2 : normalized === 'Meta' ? 4 : normalized === 'Shift' ? 8 : 0
  }
  return value
}
function button(value: number | undefined): 'left' | 'middle' | 'right' {
  if (value == null || value === 1) return 'left'
  if (value === 2) return 'middle'
  if (value === 3) return 'right'
  throw Error(`Unsupported CUA mouse button: ${value}`)
}
function nodeId(value: unknown, command: string, optional = false) {
  if (value === undefined && optional) return undefined
  if (value === undefined) throw Error(`${command} requires node_id`)
  const parsed = DomCuaClick.DomNodeIdSchema.safeParse(value)
  if (!parsed.success)
    throw Error(`${command} ${parsed.error.issues[0]?.message ?? 'has an invalid node_id'}`)
  return parsed.data
}
async function keypress(params: Params, context: Context, command: string) {
  if (Array.isArray(params.keys)) {
    const action = clipboardShortcut(params.keys)
    if (action === 'blocked')
      throw Error('Native clipboard shortcuts are disabled; use Browser Use virtual clipboard commands instead.')
    if (action != null) {
      const id = tabId(params.tab_id)
      await performVirtualClipboardShortcut(
        action, id, context as unknown as Parameters<typeof performVirtualClipboardShortcut>[2],
        async () => ({ target: { tabId: id } }), command
      )
      return {}
    }
  }
  await context.cua.dispatchKeyPress({ commandName: command, keys: params.keys!, tabId: params.tab_id })
  return {}
}
async function domClick(params: Params, context: Context, command: string, count: number) {
  const node = nodeId(params.node_id, command)!
  await context.cua.clickDomCuaNode({
    clickCount: count, nodeId: node, tabId: tabId(params.tab_id),
    ...(params.timeout_ms == null ? {} : { timeoutMs: params.timeout_ms })
  })
  return {}
}
async function typeText(params: Params, context: Context, command: string) {
  if (typeof params.text !== 'string') throw Error(`${command} requires text`)
  const text = params.text
  const id = tabId(params.tab_id)
  const rich = params.includeRichText !== false && richTextAllowed((await context.tabs.get(id)).url)
  const items = richTextClipboardItems(text, rich ? renderMarkdownRichText(text) : undefined)
  await context.clipboard.runExclusive(async () => {
    await runClipboardPageAction({
      args: {
        action: 'paste',
        clipboardItems: items,
        ...(params.inputTargetToken == null ? {} : { iabInputTargetToken: params.inputTargetToken }),
        replaceInputValue: params.replaceInputValue,
        requireDocumentFocus: params.executionContextId != null,
        ...(rich ? { richTextFallback: true } : {})
      },
      commandType: command,
      ctx: context,
      pageFunction: pastePage,
      tabId: id,
      ...(params.target == null ? {} : { target: params.target }),
      executionContextId: params.executionContextId
    })
  })
  return {}
}

export const cuaCommandHandlers = {
  cua_click: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), coordinates = point('cua_click', params)
    await context.cua.clickPoint({
      button: button(params.button), clickCount: 1,
      modifiers: modifiers(params.keys, context.runtime.platform),
      point: coordinates, tabId: id, timeoutMs: 10000
    })
    return {}
  },
  cua_double_click: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), coordinates = point('cua_double_click', params)
    await context.cua.clickPoint({
      clickCount: 2, modifiers: modifiers(params.keys, context.runtime.platform),
      point: coordinates, tabId: id, timeoutMs: 10000
    })
    return {}
  },
  cua_drag: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), flags = modifiers(params.keys, context.runtime.platform)
    if (params.path!.length === 0) throw Error('cua_drag requires a non-empty path')
    for (const item of params.path!) point('cua_drag', item)
    await context.cua.dragPath({ modifiers: flags, path: params.path!, tabId: id })
    return {}
  },
  cua_keypress: async (params: Params, context: Context) => keypress(params, context, 'cua_keypress'),
  cua_move: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), coordinates = point('cua_move', params)
    await context.cua.dispatchMouseMove(id, coordinates, modifiers(params.keys, context.runtime.platform))
    return {}
  },
  cua_scroll: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), coordinates = point('cua_scroll', params)
    await context.cua.scrollPoint({
      modifiers: modifiers(params.keys, context.runtime.platform), point: coordinates,
      scrollX: params.scroll_x!, scrollY: params.scroll_y!, tabId: id
    })
    return {}
  },
  cua_type: async (params: Params, context: Context) => typeText(params, context, 'cua_type'),
  dom_cua_click: async (params: Params, context: Context) => domClick(params, context, 'dom_cua_click', 1),
  dom_cua_double_click: async (params: Params, context: Context) => domClick(params, context, 'dom_cua_double_click', 2),
  dom_cua_keypress: async (params: Params, context: Context) => keypress(params, context, 'dom_cua_keypress'),
  dom_cua_type: async (params: Params, context: Context) => typeText(params, context, 'dom_cua_type'),
  dom_cua_get_visible_dom: async (params: Params, context: Context) =>
    await (context.visibleDom ?? new VisibleDomSnapshot(context.cdp, context.cua?.domState)).get(tabId(params.tab_id)),
  dom_cua_scroll: async (params: Params, context: Context) => {
    const id = tabId(params.tab_id), node = nodeId(params.node_id, 'dom_cua_scroll', true)
    if (node != null) {
      await context.cua.scrollDomCuaNode({ nodeId: node, scrollX: params.scroll_x!, scrollY: params.scroll_y!, tabId: id })
      return {}
    }
    const { cssVisualViewport } = await context.cdp.call(id, 'Page.getLayoutMetrics') as {
      cssVisualViewport: { clientWidth: number; clientHeight: number }
    }
    await context.cua.scrollPoint({
      modifiers: 0,
      point: { x: cssVisualViewport.clientWidth / 2, y: cssVisualViewport.clientHeight / 2 },
      scrollX: params.scroll_x!, scrollY: params.scroll_y!, tabId: id
    })
    return {}
  }
}
