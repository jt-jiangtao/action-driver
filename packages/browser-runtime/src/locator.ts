import { dispatch } from './protocol.js'
import type { ProtocolPayload, ProtocolTimeout } from './protocol.js'
import { selections, contextualError, inspectElements, diagnosticKind } from './locator-actions.js'
import type { Selection } from './locator-actions.js'
import { evaluationScript } from './evaluation.js'
import type { AgentTransport } from './transport.js'
import { isRegExp } from './utilities.js'
export type TextMatcher = string | RegExp
export interface MatchOptions {
  exact?: boolean
}
export interface TimeoutOptions {
  timeoutMs?: number | undefined
}
export interface CheckOptions extends TimeoutOptions {
  force?: boolean | undefined
}
export interface ClickOptions extends CheckOptions {
  modifiers?: string[] | undefined
  button?: 'left' | 'middle' | 'right' | undefined
}
export interface LocatorFilter {
  hasText?: TextMatcher
  hasNotText?: TextMatcher
  has?: PlaywrightLocator
  hasNot?: PlaywrightLocator
  visible?: boolean
}
export interface Scope {
  browserId: string
  tabId: string
  transport: AgentTransport
}
interface ReadValue {
  text_content: string | null
  inner_text: string
  attributes: Record<string, string>
}
interface LocatorOptions extends Scope {
  selector: string
  collectionReadCache?: CollectionReadCache | undefined
  collectionReadIndex?: number | undefined
  collectionRelativeSelector?: string | undefined
}
function regexText(value: RegExp): string {
  if (value.unicode || (value as RegExp & { unicodeSets?: boolean }).unicodeSets)
    return String(value)
  return String(value)
    .replace(/(^|[^\\])(\\\\)*(["'`])/g, '$1$2\\\\$3')
    .replace(/>>/g, '\\>\\>')
}
function matchText(value: TextMatcher, exact: boolean, attribute = false): string {
  if (typeof value !== 'string') return regexText(value)
  const encoded = attribute
    ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : JSON.stringify(value)
  return encoded + (exact ? 's' : 'i')
}
export function textSelector(kind: string, value: TextMatcher, options: MatchOptions): string {
  if (typeof value !== 'string' && !isRegExp(value))
    throw new Error(`getBy${kind} requires a string or RegExp`)
  return kind === 'Placeholder'
    ? `internal:attr=[placeholder=${matchText(value, !!options.exact, true)}]`
    : `internal:${kind.toLowerCase()}=${matchText(value, !!options.exact)}`
}
export function roleSelector(role: string, options: MatchOptions & { name?: TextMatcher }): string {
  if (!role) throw new Error('getByRole requires a role')
  return `internal:role=${role}${options.name === undefined ? '' : `[name=${matchText(options.name, !!options.exact, true)}]`}`
}
export function testIdSelector(testId: string): string {
  if (!testId) throw new Error('getByTestId requires a testId')
  return `internal:testid=[data-testid=${matchText(testId, true, true)}]`
}
export async function send(
  scope: Scope,
  type: string,
  payload: ProtocolPayload,
  ...timeout: [] | [ProtocolTimeout]
): Promise<Record<string, unknown>> {
  return (await dispatch(
    scope.transport,
    type,
    () => ({
      browser_id: scope.browserId,
      tab_id: scope.tabId,
      ...(typeof payload === 'function' ? payload() : payload)
    }),
    ...timeout
  )) as Record<string, unknown>
}

function relative(base: string | undefined, next: string): string | undefined {
  return base ? (next ? `${base} >> ${next}` : base) : next || undefined
}
class CollectionReadCache {
  private reads = new Map<string, Promise<(ReadValue | null)[]>>()
  constructor(
    private scope: Scope,
    private selector: string
  ) {}
  clear() {
    this.reads.clear()
  }
  async read(
    index: number,
    relativeSelector?: string,
    timeoutMs?: number | undefined
  ): Promise<ReadValue | null> {
    const key = relativeSelector ?? ''
    let pending = this.reads.get(key)
    if (!pending) {
      pending = send(
        this.scope,
        'playwright_locator_read_all',
        { selector: this.selector, relative_selector: relativeSelector, timeout_ms: timeoutMs },
        timeoutMs
      )
        .then((result) => result.values as (ReadValue | null)[])
        .catch((error) => {
          this.reads.delete(key)
          throw error
        })
      this.reads.set(key, pending)
    }
    return (await pending)[index] ?? null
  }
}
export class PlaywrightLocator {
  #options: LocatorOptions
  constructor({
    browserId,
    tabId,
    selector,
    transport,
    collectionReadCache,
    collectionReadIndex,
    collectionRelativeSelector
  }: LocatorOptions) {
    this.#options = {
      browserId,
      tabId,
      selector,
      transport,
      collectionReadCache,
      collectionReadIndex,
      collectionRelativeSelector
    }
  }
  static browserAuthSelector(locator: PlaywrightLocator) {
    const { browserId, tabId, selector } = locator.#options
    return { browserId, selector, tabId }
  }
  #derive(segment: string, preserveCache = true) {
    const o = this.#options
    return new PlaywrightLocator({
      ...o,
      selector: `${o.selector} >> ${segment}`,
      collectionReadCache: preserveCache ? o.collectionReadCache : undefined,
      collectionReadIndex: preserveCache ? o.collectionReadIndex : undefined,
      collectionRelativeSelector:
        preserveCache && o.collectionReadCache && o.collectionReadIndex !== undefined
          ? relative(o.collectionRelativeSelector, segment)
          : undefined
    })
  }
  assertCompatibleLocator(other: PlaywrightLocator, label: string) {
    if (!(other instanceof PlaywrightLocator))
      throw new Error(`${label} requires a PlaywrightLocator`)
    if (
      other.#options.browserId !== this.#options.browserId ||
      other.#options.tabId !== this.#options.tabId
    )
      throw new Error('Locators must belong to the same tab')
  }
  locator(selector: string, filter: LocatorFilter = {}) {
    if (!selector) throw new Error('locator.locator requires a selector')
    return this.#derive(selector).filter(filter)
  }
  first() {
    return this.#derive('nth=0')
  }
  last() {
    return this.#derive('nth=-1')
  }
  nth(index: number) {
    if (typeof index !== 'number') throw new Error('locator.nth requires a numeric index')
    return this.#derive(`nth=${index}`)
  }
  and(other: PlaywrightLocator) {
    this.assertCompatibleLocator(other, 'locator.and')
    return this.#derive(`internal:and=${JSON.stringify(other.#options.selector)}`, false)
  }
  or(other: PlaywrightLocator) {
    this.assertCompatibleLocator(other, 'locator.or')
    return this.#derive(`internal:or=${JSON.stringify(other.#options.selector)}`, false)
  }
  filter(filter: LocatorFilter = {}) {
    const segments: string[] = []
    if (filter.hasText !== undefined)
      segments.push(`internal:has-text=${matchText(filter.hasText, false)}`)
    if (filter.hasNotText !== undefined)
      segments.push(`internal:has-not-text=${matchText(filter.hasNotText, false)}`)
    for (const name of ['has', 'hasNot'] as const) {
      const other = filter[name]
      if (other !== undefined) {
        this.assertCompatibleLocator(other, `locator.filter ${name}`)
        segments.push(
          `internal:${name === 'has' ? 'has' : 'has-not'}=${JSON.stringify(other.#options.selector)}`
        )
      }
    }
    if (filter.visible !== undefined) {
      if (typeof filter.visible !== 'boolean')
        throw new Error('locator.filter visible must be a boolean')
      segments.push(`visible=${filter.visible}`)
    }
    const o = this.#options,
      segment = segments.join(' >> ')
    const cache =
      !!o.collectionReadCache &&
      o.collectionReadIndex !== undefined &&
      (!segment || o.collectionRelativeSelector !== undefined)
    return new PlaywrightLocator({
      ...o,
      selector: segment ? `${o.selector} >> ${segment}` : o.selector,
      collectionReadCache: cache ? o.collectionReadCache : undefined,
      collectionReadIndex: cache ? o.collectionReadIndex : undefined,
      collectionRelativeSelector: cache
        ? relative(o.collectionRelativeSelector, segment)
        : undefined
    })
  }
  getByRole(role: string, options: MatchOptions & { name?: TextMatcher } = {}) {
    return this.#derive(roleSelector(role, options))
  }
  getByText(text: TextMatcher, options: MatchOptions = {}) {
    return this.#derive(textSelector('Text', text, options))
  }
  getByLabel(text: TextMatcher, options: MatchOptions = {}) {
    return this.#derive(textSelector('Label', text, options))
  }
  getByPlaceholder(text: TextMatcher, options: MatchOptions = {}) {
    return this.#derive(textSelector('Placeholder', text, options))
  }
  getByTestId(testId: string) {
    return this.#derive(testIdSelector(testId))
  }
  #read(type: string, payload: ProtocolPayload = {}, ...timeout: [] | [ProtocolTimeout]) {
    return send(
      this.#options,
      type,
      () => ({
        selector: this.#options.selector,
        ...(typeof payload === 'function' ? payload() : payload)
      }),
      ...timeout
    )
  }
  cachedRead(timeoutMs?: number) {
    const o = this.#options
    return o.collectionReadCache && o.collectionReadIndex !== undefined
      ? o.collectionReadCache.read(o.collectionReadIndex, o.collectionRelativeSelector, timeoutMs)
      : Promise.resolve(null)
  }
  async count() {
    return (await this.#read('playwright_locator_count')).count as number
  }
  async all() {
    const count = await this.count(),
      o = this.#options,
      cache = new CollectionReadCache(o, o.selector)
    return Array.from(
      { length: count },
      (_, index) =>
        new PlaywrightLocator({
          ...o,
          selector: `${o.selector} >> nth=${index}`,
          collectionReadCache: cache,
          collectionReadIndex: index,
          collectionRelativeSelector: undefined
        })
    )
  }
  async textContent({ timeoutMs }: TimeoutOptions = {}) {
    const cached = await this.cachedRead(timeoutMs)
    return cached
      ? cached.text_content
      : ((
          await this.#read(
            'playwright_locator_text_content',
            () => ({ timeout_ms: timeoutMs }),
            timeoutMs
          )
        ).value as string | null)
  }
  async innerText({ timeoutMs }: TimeoutOptions = {}) {
    const cached = await this.cachedRead(timeoutMs)
    return cached
      ? cached.inner_text
      : ((
          await this.#read(
            'playwright_locator_inner_text',
            () => ({ timeout_ms: timeoutMs }),
            timeoutMs
          )
        ).value as string)
  }
  async getAttribute(name: string, { timeoutMs }: TimeoutOptions = {}) {
    if (!name) throw new Error('locator.getAttribute requires a name')
    const cached = await this.cachedRead(timeoutMs)
    return cached
      ? Object.prototype.hasOwnProperty.call(cached.attributes, name)
        ? (cached.attributes[name] ?? null)
        : null
      : ((
          await this.#read(
            'playwright_locator_get_attribute',
            () => ({ name, timeout_ms: timeoutMs }),
            timeoutMs
          )
        ).value as string | null)
  }
  async isVisible() {
    return (await this.#read('playwright_locator_is_visible')).value as boolean
  }
  async isEnabled() {
    return (await this.#read('playwright_locator_is_enabled')).value as boolean
  }
  async allTextContents({ timeoutMs }: TimeoutOptions = {}) {
    return (
      await this.#read(
        'playwright_locator_all_text_contents',
        () => ({ timeout_ms: timeoutMs }),
        timeoutMs
      )
    ).values as string[]
  }
  async #act(
    type: string,
    payload:
      | Record<string, unknown>
      | (() => { payload: Record<string, unknown>; timeoutMs: number | undefined }),
    timeoutMs: number | undefined,
    action: string,
    context: string,
    invalidate = true
  ) {
    try {
      let request: { payload: Record<string, unknown>; timeoutMs: number | undefined }
      const response = await this.#read(
        type,
        () => {
          request = typeof payload === 'function' ? payload() : { payload, timeoutMs }
          return request.payload
        },
        () => request.timeoutMs
      )
      if (invalidate) this.#options.collectionReadCache?.clear()
      return response
    } catch (error) {
      throw await this.actionError(error, action, context)
    }
  }
  async click(options: ClickOptions = {}) {
    await this.#act(
      'playwright_locator_click',
      () => ({
        payload: {
          modifiers: options.modifiers,
          button: options.button,
          force: options.force,
          timeout_ms: options.timeoutMs
        },
        timeoutMs: options.timeoutMs
      }),
      undefined,
      'click',
      `waiting on click for selector ${this.#options.selector}`
    )
  }
  async dblclick(options: ClickOptions = {}) {
    await this.#act(
      'playwright_locator_dblclick',
      () => ({
        payload: {
          modifiers: options.modifiers,
          button: options.button,
          force: options.force,
          timeout_ms: options.timeoutMs
        },
        timeoutMs: options.timeoutMs
      }),
      undefined,
      'dblclick',
      `waiting on dblclick for selector ${this.#options.selector}`
    )
  }
  async selectOption(
    value: string | Selection | (string | Selection)[],
    { timeoutMs }: TimeoutOptions = {}
  ) {
    const selected = selections(value)
    await this.#act(
      'playwright_locator_select_option',
      { selections: selected, timeout_ms: timeoutMs },
      timeoutMs,
      'selectOption',
      `locator.selectOption failed for selector ${this.#options.selector}`
    )
  }
  async fill(value: string, { timeoutMs }: TimeoutOptions = {}) {
    if (value == null) throw new Error('locator.fill requires a value')
    await this.#act(
      'playwright_locator_fill',
      { value, replace: true, timeout_ms: timeoutMs },
      timeoutMs,
      'fill',
      `locator.fill failed for selector ${this.#options.selector}`
    )
  }
  async type(value: string, { timeoutMs }: TimeoutOptions = {}) {
    if (value == null) throw new Error('locator.type requires a value')
    await this.#act(
      'playwright_locator_fill',
      { value, replace: false, timeout_ms: timeoutMs },
      timeoutMs,
      'type',
      `locator.type failed for selector ${this.#options.selector}`
    )
  }
  async pressSequentially(value: string, options: TimeoutOptions = {}) {
    if (value == null) throw new Error('locator.pressSequentially requires a value')
    await this.#act(
      'playwright_locator_press_sequentially',
      () => ({
        payload: { value, ...(options.timeoutMs == null ? {} : { timeout_ms: options.timeoutMs }) },
        timeoutMs: options.timeoutMs
      }),
      undefined,
      'pressSequentially',
      `locator.pressSequentially failed for selector ${this.#options.selector}`
    )
  }
  async press(value: string, { timeoutMs }: TimeoutOptions = {}) {
    if (value == null) throw new Error('locator.press requires a value')
    await this.#act(
      'playwright_locator_press',
      { value, timeout_ms: timeoutMs },
      timeoutMs,
      'press',
      `locator.press failed for selector ${this.#options.selector}`
    )
  }
  async setChecked(checked: boolean, options: CheckOptions = {}) {
    if (typeof checked !== 'boolean') throw new Error('locator.setChecked requires a boolean')
    await this.#act(
      'playwright_locator_set_checked',
      () => ({
        payload: { checked, force: options.force, timeout_ms: options.timeoutMs },
        timeoutMs: options.timeoutMs
      }),
      undefined,
      'setChecked',
      `locator.setChecked(${checked}) failed for selector ${this.#options.selector}`
    )
  }
  async check(options: CheckOptions = {}) {
    await this.setChecked(true, options)
  }
  async uncheck(options: CheckOptions = {}) {
    await this.setChecked(false, options)
  }
  async waitFor({
    state,
    timeoutMs
  }: TimeoutOptions & { state: 'attached' | 'detached' | 'visible' | 'hidden' }) {
    if (!state) throw new Error('locator.waitFor requires a state')
    await this.#act(
      'playwright_locator_wait_for',
      { state, timeout_ms: timeoutMs },
      timeoutMs,
      'waitFor',
      `locator.waitFor(${state}) timed out for selector ${this.#options.selector}`,
      false
    )
  }
  async downloadMedia({ timeoutMs = 120000 }: TimeoutOptions = {}) {
    return (
      await this.#act(
        'playwright_locator_download_media',
        { timeout_ms: timeoutMs },
        timeoutMs,
        'downloadMedia',
        `locator.downloadMedia failed for selector ${this.#options.selector}`
      )
    ).path as string
  }
  async actionError(error: unknown, action: string, context: string): Promise<Error> {
    try {
      const details = await this.evaluateAll(inspectElements, undefined, { timeoutMs: 1000 })
      return contextualError(
        error,
        `${context}\nLocator diagnostics: ${JSON.stringify({ kind: diagnosticKind(error, details), action, locator: this.#options.selector, ...details, truncated: details.matchCount > details.matches.length })}`
      )
    } catch {
      return contextualError(error, context)
    }
  }

  async evaluate<Result = unknown, Arg = undefined>(
    pageFunction: string | ((element: Element, arg: Arg) => Result | Promise<Result>),
    arg?: Arg,
    options?: TimeoutOptions
  ) {
    return this.#evaluateMode(pageFunction, arg, options, false) as Promise<Awaited<Result>>
  }
  async evaluateAll<Result = unknown, Arg = undefined>(
    pageFunction: string | ((elements: Element[], arg: Arg) => Result | Promise<Result>),
    arg?: Arg,
    options?: TimeoutOptions
  ) {
    return this.#evaluateMode(pageFunction, arg, options, true) as Promise<Awaited<Result>>
  }
  async #evaluateMode(
    pageFunction: unknown,
    arg: unknown,
    options: TimeoutOptions | undefined,
    all: boolean
  ) {
    return (
      await this.#read(
        'playwright_evaluate',
        () => ({
          script: evaluationScript(pageFunction, arg, all ? 'all' : 'single'),
          ...(all ? { selector_mode: 'all' } : {}),
          timeout_ms: options?.timeoutMs
        }),
        () => options?.timeoutMs
      )
    ).value
  }
}
export class PlaywrightFrameLocator {
  #options: Scope & { frameSelector: string }
  constructor({ browserId, tabId, frameSelector, transport }: Scope & { frameSelector: string }) {
    this.#options = { browserId, tabId, frameSelector, transport }
  }
  locator(selector: string) {
    if (!selector) throw new Error('frameLocator.locator requires a selector')
    return new PlaywrightLocator({
      ...this.#options,
      selector: `${this.#options.frameSelector} >> internal:control=enter-frame >> ${selector}`
    })
  }
  frameLocator(selector: string) {
    if (!selector) throw new Error('frameLocator.frameLocator requires a selector')
    return new PlaywrightFrameLocator({
      ...this.#options,
      frameSelector: `${this.#options.frameSelector} >> internal:control=enter-frame >> ${selector}`
    })
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
}
export class PlaywrightDownload {
  #options: Scope & { downloadId: string }
  constructor({ browserId, tabId, downloadId, transport }: Scope & { downloadId: string }) {
    this.#options = { browserId, tabId, downloadId, transport }
  }
  async path({ timeoutMs }: TimeoutOptions = {}) {
    return (
      ((
        await send(
          this.#options,
          'playwright_download_path',
          { download_id: this.#options.downloadId, timeout_ms: timeoutMs },
          timeoutMs
        )
      ).path as string) ?? null
    )
  }
}
