import type { AgentTransport } from './transport.js'
import { dispatch } from './protocol.js'
export interface BrowserHistoryOptions {
  queries?: string[] | null
  limit?: number | null
  from?: Date | string | number | null
  to?: Date | string | number | null
}
export interface BrowserHistoryItem {
  url: string
  title?: string
  dateVisited: string
}
function queries(value: BrowserHistoryOptions['queries']) {
  if (value == null) return undefined
  if (!Array.isArray(value) || !value.length)
    throw new Error('browser.history received invalid queries')
  const copy: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('browser.history received invalid queries')
    copy.push(item)
  }
  return copy
}
function limit(value: BrowserHistoryOptions['limit']) {
  if (value != null) {
    if (!Number.isInteger(value) || value <= 0)
      throw new Error('browser.history received an invalid limit')
    return value
  }
}
function date(value: BrowserHistoryOptions['from'], label: string) {
  if (value == null) return undefined
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`browser.history received an invalid ${label} date`)
  return parsed.toISOString()
}
/** Core Browser behavior used by the composed Browser client. */
export class BrowserControls {
  browserId: string
  #browserId: string
  #used: (() => void) | undefined
  #transport: AgentTransport
  constructor({
    browserId,
    onBrowserUsed,
    transport
  }: {
    browserId: string
    onBrowserUsed?: () => void
    transport: AgentTransport
  }) {
    this.browserId = browserId
    this.#browserId = browserId
    this.#used = onBrowserUsed
    this.#transport = transport
  }
  async documentation() {
    this.#used?.()
    return (await dispatch(this.#transport, 'get_browser_documentation', () => ({
      browser_id: this.browserId
    }))) as string
  }
  async history(options: BrowserHistoryOptions = {}) {
    if (options === null || Array.isArray(options) || typeof options !== 'object')
      throw new Error('browser.history expects an options object')
    const payload: Record<string, unknown> = { browser_id: this.#browserId }
    const q = queries(options.queries),
      n = limit(options.limit),
      from = date(options.from, 'from'),
      to = date(options.to, 'to')
    if (q !== undefined) payload.queries = q
    if (n !== undefined) payload.limit = n
    if (from !== undefined) payload.from = from
    if (to !== undefined) payload.to = to
    return (
      (await dispatch(this.#transport, 'browser_user_history', payload)) as {
        items: BrowserHistoryItem[]
      }
    ).items
  }
  async nameSession(name: string) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('browser.nameSession requires a name')
    await dispatch(this.#transport, 'name_session', () => ({
      browser_id: this.browserId,
      name: trimmed
    }))
  }
}
