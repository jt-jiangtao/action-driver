import { isIP } from 'node:net'
export interface TurnMetadata {
  session_id: string
  turn_id: string
}
type Cleanup = (metadata: TurnMetadata) => unknown | Promise<unknown>
export interface TurnHookHost {
  addTurnEndedHandler?: (hook: {
    timeoutMs: number
    run: (metadata: TurnMetadata) => Promise<void>
  }) => () => void
}
export class TurnEndedTracker {
  disposed = false
  sessions = new Map<string, Map<Cleanup, string>>()
  removeTurnEndedHandler: () => void
  constructor(host: TurnHookHost) {
    if (host.addTurnEndedHandler == null)
      throw Error('Browser Use requires Node REPL turn-ended hooks')
    this.removeTurnEndedHandler = host.addTurnEndedHandler({
      timeoutMs: 4000,
      run: ({ session_id, turn_id }) => this.finishTurn({ session_id, turn_id })
    })
  }
  async track(metadata: TurnMetadata, cleanup: Cleanup) {
    if (this.disposed) return
    let callbacks = this.sessions.get(metadata.session_id)
    if (!callbacks) {
      callbacks = new Map()
      this.sessions.set(metadata.session_id, callbacks)
    }
    callbacks.set(cleanup, metadata.turn_id)
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.removeTurnEndedHandler()
    this.sessions.clear()
  }
  async finishTurn(metadata: TurnMetadata) {
    const callbacks = this.sessions.get(metadata.session_id)
    if (!callbacks) return
    const pending: Cleanup[] = []
    for (const [callback, turn] of callbacks)
      if (turn === metadata.turn_id) {
        callbacks.delete(callback)
        pending.push(callback)
      }
    if (!callbacks.size) this.sessions.delete(metadata.session_id)
    await Promise.all(
      pending.map(async (callback) => {
        try {
          await callback(metadata)
        } catch {
          /* One failing browser must not prevent other turn cleanup. */
        }
      })
    )
  }
}
export interface BackendInfo {
  type: string
  family?: string
  metadata?: { extensionInstanceId?: string; [key: string]: unknown }
  [key: string]: unknown
}
export interface BackendApi {
  getTabs(): Promise<{ url?: unknown }[]>
  getUserTabs(): Promise<{ url?: unknown }[]>
  close(): Promise<unknown>
  addCloseListener(listener: () => void): unknown
}
export interface BackendBrowser {
  id: string
  info: BackendInfo
  api: BackendApi
  pipe?: string
}
export interface BrowserPreference {
  extensionInstanceId: string
  preferredWindowId?: number
}
const families = new Set(['chrome', 'edge', 'brave', 'opera', 'vivaldi'])
export function findBrowser<T extends BackendBrowser>(items: T[], id: string): T | undefined {
  if (['extension', 'iab', 'cdp'].includes(id)) return items.find((item) => item.info.type === id)
  if (families.has(id))
    return items.find(
      (item) => item.info.type === 'extension' && (item.info.family ?? 'chrome') === id
    )
  return items.find((item) => item.id === id)
}
export function matchesPreference(
  info: BackendInfo,
  preference: BrowserPreference | null | undefined
) {
  return (
    preference != null &&
    info.type === 'extension' &&
    info.metadata?.extensionInstanceId === preference.extensionInstanceId
  )
}
export function defaultBrowser<T extends BackendBrowser>(
  items: T[],
  preference: BrowserPreference | null | undefined
) {
  return (
    items.find((item) => item.info.type === 'iab') ??
    items.find((item) => matchesPreference(item.info, preference)) ??
    items.find((item) => item.info.type === 'extension') ??
    items[0]
  )
}
function local(url: URL) {
  const host = url.hostname.toLowerCase()
  return (
    url.protocol === 'file:' ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    ['127.0.0.1', '[::1]', '::1'].includes(host)
  )
}
function canonical(url: URL) {
  const value = new URL(url)
  value.hash = ''
  return value.href
}
function hierarchy(a: string, b: string) {
  a = a.toLowerCase().replace(/\.$/, '')
  b = b.toLowerCase().replace(/\.$/, '')
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return short.includes('.') && isIP(short) === 0 && long.endsWith(`.${short}`)
}
async function tabUrls(item: BackendBrowser) {
  if (!['iab', 'extension'].includes(item.info.type)) return []
  const request = item.info.type === 'extension' ? item.api.getUserTabs() : item.api.getTabs()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return (
      await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Timed out after 1000ms waiting for open browser tabs.')),
            1000
          )
        })
      ])
    ).flatMap((tab) => (typeof tab.url === 'string' ? [tab.url] : []))
  } catch {
    return []
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
export async function browserForUrl<T extends BackendBrowser>(
  items: T[],
  input: string,
  preference: BrowserPreference | null | undefined
): Promise<T | undefined> {
  const url = new URL(input)
  if (items.length === 1) return items[0]
  if (local(url)) {
    const iab = items.find((item) => item.info.type === 'iab')
    if (iab) return iab
  }
  const candidates = await Promise.all(
      items.map(async (item) => ({ item, urls: await tabUrls(item) }))
    ),
    iab = candidates.filter(({ item }) => item.info.type === 'iab'),
    extensions = candidates.filter(({ item }) => item.info.type === 'extension'),
    all = [...iab, ...extensions]
  const pick = (list: typeof candidates) =>
    list.find(({ item }) => item.info.type === 'iab') ??
    list.find(({ item }) => matchesPreference(item.info, preference)) ??
    list[0]
  const tiers = [
    (other: URL) => canonical(other) === canonical(url),
    (other: URL) => other.origin === url.origin && other.pathname === url.pathname,
    (other: URL) => other.hostname === url.hostname,
    (other: URL) => hierarchy(other.hostname, url.hostname)
  ]
  for (const match of tiers) {
    const found = pick(
      all.filter(({ urls }) =>
        urls.some((raw) => {
          try {
            return match(new URL(raw))
          } catch {
            return false
          }
        })
      )
    )
    if (found) return found.item
  }
  return (pick(iab) ?? pick(extensions))?.item ?? items[0]
}
export type BackendLoader<Host> = (
  host: Host,
  createApi: (transport: unknown) => BackendApi,
  previous: BackendBrowser[],
  preferences: unknown
) => Promise<BackendBrowser[]>
/** Backend assembly is explicit so context never falls back to the legacy package. */
export class BrowserContext<Host extends TurnHookHost> {
  browsers: BackendBrowser[] | null = null
  clientApi = { ping: () => 'pong' }
  refreshPromise: Promise<void> | null = null
  turnEndedTracker: TurnEndedTracker
  trackedApis = new WeakSet<BackendApi>()
  constructor(
    public runtime: Host,
    public browserPreference: BrowserPreference | null,
    public preferences: unknown,
    private load: BackendLoader<Host>,
    private createApi: (transport: unknown) => BackendApi = () => {
      throw Error('Browser backend API factory is required')
    }
  ) {
    this.turnEndedTracker = new TurnEndedTracker(runtime)
  }
  async refresh() {
    this.refreshPromise ??= (async () => {
      const items = await this.load(
        this.runtime,
        this.createApi,
        this.browsers ?? [],
        this.preferences
      )
      this.browsers = items
      for (const item of items) this.trackBrowser(item)
    })().finally(() => {
      this.refreshPromise = null
    })
    await this.refreshPromise
  }
  list() {
    return this.getBrowsers()
  }
  async get(id: string) {
    const item = findBrowser(await this.getBrowsers(), id)
    if (!item) throw Error(`Browser is not available: ${id}`)
    return item
  }
  async getDefault() {
    const item = defaultBrowser(await this.getBrowsers(), this.browserPreference)
    if (!item) throw Error('No browser is available')
    return item
  }
  async getForUrl(url: string) {
    const item = await browserForUrl(await this.getBrowsers(), url, this.browserPreference)
    if (!item) throw Error('No browser is available')
    return item
  }
  preferredWindowIdFor(info: BackendInfo) {
    return matchesPreference(info, this.browserPreference)
      ? this.browserPreference?.preferredWindowId
      : undefined
  }
  async dispose() {
    if (this.refreshPromise !== null) await this.refreshPromise
    this.turnEndedTracker.dispose()
    const items = this.browsers
    this.browsers = null
    await Promise.all(items?.map((item) => item.api.close()) ?? [])
  }
  async getBrowsers() {
    if (this.browsers === null) await this.refresh()
    return this.browsers ?? []
  }
  trackBrowser(item: BackendBrowser) {
    if (this.trackedApis.has(item.api)) return
    this.trackedApis.add(item.api)
    item.api.addCloseListener(() => {
      if (this.browsers !== null)
        this.browsers = this.browsers.filter((current) => current !== item)
    })
  }
}
