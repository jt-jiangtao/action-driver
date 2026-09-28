import { send } from './locator.js'
import type { Scope, TimeoutOptions } from './locator.js'
export function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
}
export type AXMode = 'state' | 'screenshot' | 'both'
export interface AXCaptureOptions {
  disableDiffing?: boolean
}
export interface AXObservation {
  state: string
  screenshot?: Uint8Array
}
export class AXAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  get(mode?: 'state', options?: AXCaptureOptions): Promise<string>
  get(mode: 'screenshot', options?: AXCaptureOptions): Promise<Uint8Array>
  get(mode: 'both', options?: AXCaptureOptions): Promise<AXObservation>
  get(mode: AXMode, options?: AXCaptureOptions): Promise<string | Uint8Array | AXObservation>
  async get(mode: AXMode = 'state', options?: AXCaptureOptions) {
    const captured = await this.#capture(mode, options)
    switch (captured.mode) {
      case 'state':
        return captured.state!
      case 'screenshot':
        return captured.screenshot!
      case 'both':
        return captured.screenshot === undefined
          ? { state: captured.state! }
          : { state: captured.state!, screenshot: captured.screenshot }
    }
  }
  async write(mode: AXMode = 'state', options?: AXCaptureOptions) {
    const captured = await this.#capture(mode, options)
    if (captured.mode !== 'screenshot') await this.#scope.transport.display(captured.state)
    if (captured.mode !== 'state' && captured.screenshot !== undefined)
      await this.#scope.transport.display(captured.screenshot)
  }
  async #capture(
    mode: AXMode,
    options?: AXCaptureOptions
  ): Promise<{ mode: AXMode; state?: string; screenshot?: Uint8Array }> {
    const response = await send(this.#scope, 'tab_ax_get_state', () => ({
      content:
        mode === 'state'
          ? 'axState'
          : mode === 'screenshot'
            ? 'screenshot'
            : 'axStateAndScreenshot',
      ...(options?.disableDiffing === undefined ? {} : { disable_diffing: options.disableDiffing })
    }))
    if (mode === 'state') {
      if (typeof response.state !== 'string')
        throw new Error('ax capture returned no accessibility state')
      return { mode, state: response.state }
    }
    if (typeof response.data !== 'string') {
      if (
        mode === 'both' &&
        typeof response.screenshot_unavailable === 'string' &&
        typeof response.state === 'string'
      )
        return { mode, state: response.state }
      throw new Error('ax capture returned no screenshot data')
    }
    const screenshot = decodeBase64(response.data)
    if (mode === 'screenshot') return { mode, screenshot }
    if (typeof response.state !== 'string')
      throw new Error('ax capture returned no accessibility state')
    return { mode, state: response.state, screenshot }
  }
  async #action(action: Record<string, unknown>) {
    await send(this.#scope, 'tab_ax_action', () => ({ action }))
  }
  async click(target: unknown, options?: { mouseButton?: string; clickCount?: number }) {
    await this.#action({
      kind: 'click',
      target,
      ...(options?.mouseButton === undefined ? {} : { mouse_button: options.mouseButton }),
      ...(options?.clickCount === undefined ? {} : { click_count: options.clickCount })
    })
  }
  async drag(from: unknown, to: unknown) {
    await this.#action({ kind: 'drag', from, to })
  }
  async paste(element_index: number | null, text: string, options?: { format?: string }) {
    await this.#action({ kind: 'paste', element_index, text, format: options?.format })
  }
  async performSecondaryAction(element_index: number, action: string) {
    await this.#action({ kind: 'perform_secondary_action', element_index, action })
  }
  async pressKey(element_index: number | null, key: string) {
    await this.#action({ kind: 'press_key', element_index, key })
  }
  async scroll(target: unknown, direction: string, pages?: number) {
    await this.#action({
      kind: 'scroll',
      target,
      direction,
      ...(pages === undefined ? {} : { pages })
    })
  }
  async selectText(
    element_index: number,
    text: string,
    options?: { prefix?: string; suffix?: string; selectionType?: string }
  ) {
    await this.#action({
      kind: 'select_text',
      element_index,
      text,
      ...(options?.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(options?.suffix === undefined ? {} : { suffix: options.suffix }),
      ...(options?.selectionType === undefined ? {} : { selection_type: options.selectionType })
    })
  }
  async setValue(element_index: number, value: string) {
    await this.#action({ kind: 'set_value', element_index, value })
  }
  async typeText(element_index: number | null, text: string) {
    await this.#action({ kind: 'type_text', element_index, text })
  }
}
interface Point {
  x: number
  y: number
}
export class CUAAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  async click(options: Point & { button?: number; keypress?: string[] }) {
    if (typeof options?.x !== 'number' || typeof options?.y !== 'number')
      throw new Error('cua.click requires x and y')
    await send(this.#scope, 'cua_click', () => ({
      x: options.x,
      y: options.y,
      button: options.button,
      keys: options.keypress
    }))
  }
  async scroll(options: Point & { scrollX: number; scrollY: number; keypress?: string[] }) {
    if (
      typeof options?.x !== 'number' ||
      typeof options?.y !== 'number' ||
      typeof options?.scrollX !== 'number' ||
      typeof options?.scrollY !== 'number'
    )
      throw new Error('cua.scroll requires x, y, scrollX, and scrollY')
    await send(this.#scope, 'cua_scroll', () => ({
      x: options.x,
      y: options.y,
      scroll_x: options.scrollX,
      scroll_y: options.scrollY,
      keys: options.keypress
    }))
  }
  async double_click(options: Point & { keypress?: string[] }) {
    if (typeof options?.x !== 'number' || typeof options?.y !== 'number')
      throw new Error('cua.double_click requires x and y')
    await send(this.#scope, 'cua_double_click', () => ({
      x: options.x,
      y: options.y,
      keys: options.keypress
    }))
  }
  async type(options: { text: string }) {
    if (typeof options?.text !== 'string') throw new Error('cua.type requires text')
    await send(this.#scope, 'cua_type', () => ({ text: options.text }))
  }
  async keypress(options: { keys: string[] }) {
    if (!Array.isArray(options?.keys) || !options.keys.length)
      throw new Error('cua.keypress requires a non-empty keys array')
    await send(this.#scope, 'cua_keypress', () => ({ keys: options.keys }))
  }
  async drag(options: { path: Point[]; keys?: string[] }) {
    if (
      !Array.isArray(options?.path) ||
      !options.path.length ||
      options.path.some((point) => typeof point?.x !== 'number' || typeof point?.y !== 'number')
    )
      throw new Error('cua.drag requires a non-empty path of {x, y} points')
    await send(this.#scope, 'cua_drag', () => ({ path: options.path, keys: options.keys }))
  }
  async move(options: Point & { keys?: string[] }) {
    if (typeof options?.x !== 'number' || typeof options?.y !== 'number')
      throw new Error('cua.move requires x and y')
    await send(this.#scope, 'cua_move', () => ({ x: options.x, y: options.y, keys: options.keys }))
  }
  async downloadMedia(options: Point & TimeoutOptions) {
    if (typeof options?.x !== 'number' || typeof options?.y !== 'number')
      throw new Error('cua.downloadMedia requires x and y')
    await send(
      this.#scope,
      'cua_download_media',
      () => ({ x: options.x, y: options.y, timeout_ms: options.timeoutMs }),
      () => options.timeoutMs
    )
  }
}
function nodeId(value: unknown, context: string, required = true): string {
  if (required && value === undefined) throw new Error(`${context} requires a node_id`)
  if (typeof value !== 'string') throw new Error(`${context} node_id must be a string`)
  if (!value.length) throw new Error(`${context} node_id must not be empty`)
  return value
}
export class DomCUAAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  async get_visible_dom() {
    return send(this.#scope, 'dom_cua_get_visible_dom', () => ({}))
  }
  async click(options: { node_id: string }) {
    const node_id = nodeId(options?.node_id, 'dom_cua.click')
    await send(this.#scope, 'dom_cua_click', () => ({ node_id }))
  }
  async double_click(options: { node_id: string }) {
    const node_id = nodeId(options?.node_id, 'dom_cua.double_click')
    await send(this.#scope, 'dom_cua_double_click', () => ({ node_id }))
  }
  async scroll({ node_id, x, y }: { node_id?: string; x: number; y: number }) {
    if (typeof x !== 'number' || typeof y !== 'number')
      throw new Error('dom_cua.scroll requires x and y numbers')
    await send(this.#scope, 'dom_cua_scroll', () => ({
      node_id: node_id === undefined ? undefined : nodeId(node_id, 'dom_cua.scroll', false),
      scroll_x: x,
      scroll_y: y
    }))
  }
  async type({ text }: { text: string }) {
    if (typeof text !== 'string') throw new Error('dom_cua.type requires text')
    await send(this.#scope, 'dom_cua_type', () => ({ text }))
  }
  async keypress(options: { keys: string[] }) {
    if (!Array.isArray(options?.keys) || !options.keys.length)
      throw new Error('dom_cua.keypress requires a non-empty keys array')
    await send(this.#scope, 'dom_cua_keypress', () => ({ keys: options.keys }))
  }
  async downloadMedia(options: { node_id: string } & TimeoutOptions) {
    const node_id = nodeId(options?.node_id, 'dom_cua.downloadMedia')
    await send(
      this.#scope,
      'dom_cua_download_media',
      () => ({ node_id, timeout_ms: options.timeoutMs }),
      () => options.timeoutMs
    )
  }
}
export class ContentAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  async export() {
    return (await send(this.#scope, 'tab_content_export', () => ({}))).path as string
  }
  async exportGsuite(format: 'pdf' | 'md' | 'xlsx' | 'csv' | 'docx' | 'pptx') {
    return (await send(this.#scope, 'tab_content_export_gsuite', () => ({ format }))).path as string
  }
  async exportYouTubeTranscript() {
    return (await send(this.#scope, 'tab_content_export_youtube_transcript', () => ({})))
      .path as string
  }
}
export interface ClipboardEntry {
  mimeType: string
  text?: string | undefined
  base64?: string | undefined
}
export interface ClipboardItem {
  entries: ClipboardEntry[]
  presentationStyle?: string | undefined
}
interface WireItem {
  entries: { mime_type: string; text?: string; base64?: string }[]
  presentation_style?: string
}
export class TabClipboardAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  async readText() {
    return (await send(this.#scope, 'tab_clipboard_read_text', () => ({}))).text as string
  }
  async writeText(text: string) {
    if (text == null) throw new Error('tab.clipboard.writeText requires text')
    await send(this.#scope, 'tab_clipboard_write_text', () => ({ text }))
  }
  async read(): Promise<ClipboardItem[]> {
    return ((await send(this.#scope, 'tab_clipboard_read', () => ({}))).items as WireItem[]).map(
      (item) => ({
        entries: item.entries.map((entry) => ({
          mimeType: entry.mime_type,
          text: entry.text,
          base64: entry.base64
        })),
        presentationStyle: item.presentation_style
      })
    )
  }
  async write(items: ClipboardItem[]) {
    if (!Array.isArray(items) || !items.length)
      throw new Error('tab.clipboard.write requires at least one clipboard item')
    await send(this.#scope, 'tab_clipboard_write', () => ({
      items: items.map((item) => ({
        presentation_style: item.presentationStyle,
        entries: item.entries.map((entry) => ({
          mime_type: entry.mimeType,
          text: entry.text,
          base64: entry.base64
        }))
      }))
    }))
  }
}
export type LogLevel = 'debug' | 'info' | 'log' | 'warn' | 'error'
export interface TabLog {
  level: LogLevel
  message: string
  timestamp: string
  url?: string
}
export class TabDevAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  async logs(
    options: {
      filter?: string | null
      levels?: (LogLevel | 'warning')[] | null
      limit?: number | null
    } = {}
  ) {
    const filter = options.filter
    if (filter != null && typeof filter !== 'string')
      throw new Error('tab.dev.logs received an invalid filter')
    const inputLevels = options.levels
    let levels: LogLevel[] | undefined
    if (inputLevels != null) {
      if (!Array.isArray(inputLevels) || !inputLevels.length)
        throw new Error('tab.dev.logs received invalid levels')
      levels = inputLevels.map((level) => {
        if (level === 'warning') return 'warn'
        if (['debug', 'info', 'log', 'warn', 'error'].includes(level)) return level
        throw new Error(`tab.dev.logs received invalid level "${String(level)}"`)
      })
    }
    const limit = options.limit
    if (limit != null && (!Number.isInteger(limit) || limit <= 0))
      throw new Error('tab.dev.logs received an invalid limit')
    return (
      await send(this.#scope, 'tab_dev_logs', () => ({
        ...(filter == null ? {} : { filter }),
        ...(levels === undefined ? {} : { levels }),
        ...(limit == null ? {} : { limit })
      }))
    ).logs as TabLog[]
  }
}
