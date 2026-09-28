import type { SessionHost } from './computer-session.js'
type EmitOptions = { emit?: boolean }
type StateOptions = EmitOptions & { disableDiffing?: boolean }
type Target = number | [number, number]
type ClickOptions = { mouseButton?: string; clickCount?: number }
type SelectionOptions = { prefix?: string; suffix?: string; selectionType?: string }
export interface BrowserAX {
  get(mode: 'state', options?: { disableDiffing: boolean }): Promise<string>
  get(mode: 'screenshot'): Promise<Uint8Array>
  get(
    mode: 'both',
    options?: { disableDiffing: boolean }
  ): Promise<{ state: string; screenshot?: Uint8Array }>
  paste(index: number | null, text: string, options?: { format?: string }): Promise<unknown>
  click(target: Target, options?: ClickOptions): Promise<unknown>
  drag(from: Target, to: Target): Promise<unknown>
  pressKey(index: number | null, key: string): Promise<unknown>
  scroll(target: Target, direction: string, pages?: number): Promise<unknown>
  selectText(index: number, text: string, options?: SelectionOptions): Promise<unknown>
  setValue(index: number, value: string): Promise<unknown>
  typeText(index: number | null, text: string): Promise<unknown>
  performSecondaryAction(index: number, action: string): Promise<unknown>
}
function focusIndex(index: number | null): void {
  if (index !== null && (!Number.isInteger(index) || index < 0))
    throw new Error(
      'Browser input requires an element index from the latest AX snapshot, or null to use current focus.'
    )
}
const captureOptions = (options?: StateOptions) =>
  options?.disableDiffing === undefined ? undefined : { disableDiffing: options.disableDiffing }
/** Adds the CUA facade to a browser runtime tab without replacing the tab identity. */
export function decorateBrowserTab<T extends { ax: BrowserAX }>(
  tab: T,
  getHost: () => SessionHost | undefined = () => undefined
) {
  async function emitState(state: string, options?: EmitOptions) {
    if (options?.emit !== false) await getHost()?.write?.(state, 'cua.state')
  }
  async function emitImage(bytes: Uint8Array, options?: EmitOptions) {
    if (options?.emit !== false) await getHost()?.emitImage?.({ bytes, mimeType: 'image/png' })
  }
  return Object.assign(tab, {
    async getAXState(options?: StateOptions) {
      const state = await tab.ax.get('state', captureOptions(options))
      await emitState(state, options)
      return state
    },
    async getScreenshot(options?: EmitOptions) {
      const bytes = await tab.ax.get('screenshot')
      await emitImage(bytes, options)
      return bytes
    },
    async getAXStateAndScreenshot(options?: StateOptions) {
      const result = await tab.ax.get('both', captureOptions(options))
      await emitState(result.state, options)
      if (result.screenshot !== undefined) await emitImage(result.screenshot, options)
      return result
    },
    async paste(index: number | null, text: string, options?: { format?: string }) {
      focusIndex(index)
      await tab.ax.paste(index, text, options)
    },
    click: (target: Target, options?: ClickOptions) => tab.ax.click(target, options),
    drag: (from: Target, to: Target) => tab.ax.drag(from, to),
    pressKey: (index: number | null, key: string) => {
      focusIndex(index)
      return tab.ax.pressKey(index, key)
    },
    scroll: (target: Target, direction: string, pages?: number) =>
      tab.ax.scroll(target, direction, pages),
    selectText: (index: number, text: string, options?: SelectionOptions) =>
      tab.ax.selectText(index, text, options),
    setValue: (index: number, value: string) => tab.ax.setValue(index, value),
    typeText: (index: number | null, text: string) => {
      focusIndex(index)
      return tab.ax.typeText(index, text)
    },
    performSecondaryAction: (index: number, action: string) =>
      tab.ax.performSecondaryAction(index, action)
  })
}
