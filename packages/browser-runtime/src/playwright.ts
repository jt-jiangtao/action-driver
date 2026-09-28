import {
  PlaywrightLocator,
  PlaywrightFrameLocator,
  PlaywrightDownload,
  send,
  roleSelector,
  textSelector,
  testIdSelector
} from './locator.js'
import type { Scope, TextMatcher, MatchOptions, TimeoutOptions } from './locator.js'
import { evaluationScript } from './evaluation.js'
interface NavigationOptions extends TimeoutOptions {
  waitUntil?: string | undefined
  url?: string | undefined
}
interface Point {
  x: number
  y: number
  includeNonInteractable?: boolean
}
function withContext(error: unknown, context: string): Error {
  const wrapped = new Error(`${error instanceof Error ? error.message : String(error)}\n${context}`)
  if (error instanceof Error && error.stack)
    wrapped.stack = `${wrapped.name}: ${wrapped.message}\n${error.stack}`
  return wrapped
}
export class PlaywrightFileChooser {
  #options: Scope & { fileChooserId: string; isMultiple: boolean }
  constructor({
    browserId,
    tabId,
    fileChooserId,
    isMultiple,
    transport
  }: Scope & { fileChooserId: string; isMultiple: boolean }) {
    this.#options = { browserId, tabId, fileChooserId, isMultiple, transport }
  }
  isMultiple() {
    return this.#options.isMultiple
  }
  async setFiles(files: string | string[], { timeoutMs }: TimeoutOptions = {}) {
    if (files == null) throw new Error('fileChooser.setFiles requires files')
    const list = Array.isArray(files) ? files : [files]
    if (!list.length) throw new Error('fileChooser.setFiles requires at least one file')
    try {
      await send(
        this.#options,
        'playwright_file_chooser_set_files',
        () => ({
          file_chooser_id: this.#options.fileChooserId,
          files: list,
          timeout_ms: timeoutMs
        }),
        timeoutMs
      )
    } catch (error) {
      throw withContext(error, 'fileChooser.setFiles failed')
    }
  }
}
export class PlaywrightAPI {
  #scope: Scope
  constructor({ browserId, tabId, transport }: Scope) {
    this.#scope = { browserId, tabId, transport }
  }
  async goBack() {
    await send(this.#scope, 'navigate_tab_back', () => ({}))
  }
  async goForward() {
    await send(this.#scope, 'navigate_tab_forward', () => ({}))
  }
  async evaluate<Result = unknown, Arg = undefined>(
    pageFunction: string | ((arg: Arg) => Result | Promise<Result>),
    arg?: Arg,
    options?: TimeoutOptions
  ) {
    return (
      await send(
        this.#scope,
        'playwright_evaluate',
        () => ({
          script: evaluationScript(pageFunction, arg, 'page'),
          timeout_ms: options?.timeoutMs
        }),
        () => options?.timeoutMs
      )
    ).value as Awaited<Result>
  }
  locator(selector: string) {
    if (!selector) throw new Error('playwright.locator requires a selector')
    return new PlaywrightLocator({ ...this.#scope, selector })
  }
  frameLocator(frameSelector: string) {
    if (!frameSelector) throw new Error('playwright.frameLocator requires a selector')
    return new PlaywrightFrameLocator({ ...this.#scope, frameSelector })
  }
  getByRole(role: string, options: MatchOptions & { name?: TextMatcher } = {}) {
    return this.locator(roleSelector(role, options))
  }
  getByText(text: TextMatcher, options: MatchOptions = {}) {
    return this.locator(textSelector('Text', text, options))
  }
  getByLabel(text: TextMatcher, options: MatchOptions = {}) {
    return this.locator(textSelector('Label', text, options))
  }
  getByPlaceholder(text: TextMatcher, options: MatchOptions = {}) {
    return this.locator(textSelector('Placeholder', text, options))
  }
  getByTestId(testId: string) {
    return this.locator(testIdSelector(testId))
  }
  async waitForURL(url: string, options: NavigationOptions = {}) {
    if (!url) throw new Error('playwright.waitForURL requires a url')
    await send(
      this.#scope,
      'playwright_wait_for_url',
      () => ({ url, wait_until: options.waitUntil, timeout_ms: options.timeoutMs }),
      () => options.timeoutMs
    )
  }
  async waitForLoadState(options: TimeoutOptions & { state?: string | undefined } = {}) {
    await send(
      this.#scope,
      'playwright_wait_for_load_state',
      () => ({ state: options.state, timeout_ms: options.timeoutMs }),
      () => options.timeoutMs
    )
  }
  async waitForTimeout(timeoutMs: number) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0)
      throw new Error('playwright.waitForTimeout requires a non-negative integer')
    await send(
      this.#scope,
      'playwright_wait_for_timeout',
      () => ({ timeout_ms: timeoutMs }),
      timeoutMs + 2000
    )
  }
  waitForEvent(event: 'download', options?: TimeoutOptions): Promise<PlaywrightDownload>
  waitForEvent(event: 'filechooser', options?: TimeoutOptions): Promise<PlaywrightFileChooser>
  waitForEvent(event: string, options: TimeoutOptions = {}) {
    const pending = this.#event(event, options)
    // A caller may create this promise before initiating the action that raises the event.
    pending.catch(() => {})
    return pending
  }
  async #event(event: string, options: TimeoutOptions) {
    if (event === 'download') {
      const timeoutMs = options.timeoutMs ?? 120000
      const result = await send(
        this.#scope,
        'playwright_wait_for_download',
        () => ({ timeout_ms: timeoutMs }),
        timeoutMs
      )
      return new PlaywrightDownload({ ...this.#scope, downloadId: result.download_id as string })
    }
    if (event === 'filechooser') {
      const result = await send(
        this.#scope,
        'playwright_wait_for_file_chooser',
        () => ({ timeout_ms: options.timeoutMs }),
        () => options.timeoutMs
      )
      return new PlaywrightFileChooser({
        ...this.#scope,
        fileChooserId: result.file_chooser_id as string,
        isMultiple: result.is_multiple as boolean
      })
    }
    throw new Error("playwright.waitForEvent only supports 'download' and 'filechooser'")
  }
  async expectNavigation<T>(
    action: () => T | Promise<T>,
    options: NavigationOptions = {}
  ): Promise<T> {
    const wait = options.url
      ? this.waitForURL(options.url, { timeoutMs: options.timeoutMs, waitUntil: options.waitUntil })
      : this.waitForLoadState({ timeoutMs: options.timeoutMs, state: options.waitUntil })
    const [value] = await Promise.all([Promise.resolve().then(action), wait])
    return value
  }
  #coordinates(point: Point, label: string) {
    const { x, y } = point
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error(`playwright.${label} requires numeric x and y coordinates`)
    return { x, y }
  }
  async elementInfo(point: Point) {
    const coordinates = this.#coordinates(point, 'elementInfo')
    return await send(this.#scope, 'playwright_element_info', () => ({
      ...coordinates,
      include_non_interactable: point.includeNonInteractable
    }))
  }
  async elementScreenshot(point: Point) {
    const coordinates = this.#coordinates(point, 'elementScreenshot')
    const result = await send(this.#scope, 'playwright_element_screenshot', () => ({
      ...coordinates,
      include_non_interactable: point.includeNonInteractable
    }))
    return Uint8Array.from(atob(result.data as string), (character) => character.charCodeAt(0))
  }
  async domSnapshot() {
    return (await send(this.#scope, 'playwright_dom_snapshot', () => ({}))).dom_snapshot as string
  }
}
