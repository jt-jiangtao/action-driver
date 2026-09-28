import { BrowserUseSecurityError } from './service-security-approval.js'
import type { BrowserCdp } from './service-cdp.js'
import type { CdpEvent } from './service-cdp-events.js'
type WaitCdp = Pick<
  BrowserCdp,
  'call' | 'readDocumentState' | 'waitForEvent' | 'on' | 'removeListener'
>
type LoadState = 'load' | 'domcontentloaded' | 'networkidle'
const top = (event: CdpEvent) => event.source.sessionId == null
const blocked = (event: CdpEvent) =>
  event.method === 'Page.navigationBlocked' && event.params?.resourceType !== 'subFrame'
export function assertNavigationEvent(event: CdpEvent | undefined) {
  if (event?.method !== 'Page.navigationBlocked') return
  let display = 'this page'
  try {
    const raw = event.params?.url
    if (typeof raw === 'string') {
      const url = new URL(raw)
      if (['http:', 'https:'].includes(url.protocol)) {
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        display = url.pathname === '/' ? url.toString().slice(0, -1) : url.toString()
      }
    }
  } catch {}
  throw new BrowserUseSecurityError(
    'browser_navigation_blocked',
    `Browser Use is not permitted on ${display}.`
  )
}
export async function waitForNetworkIdle(cdp: WaitCdp, id: number, timeoutMs: number) {
  const deadlineMs = Date.now() + timeoutMs,
    options = { deadlineMs, preserveDebuggerOnTimeout: true },
    pending: CdpEvent[] = []
  let frame: { id: string; loaderId?: string } | undefined,
    idle = false,
    error: Error | undefined,
    wake = () => {}
  const timeout = () => Error(`Timed out waiting for networkidle in tab ${id}.`)
  const event = (event: CdpEvent) => {
    if (
      event.source.tabId !== id ||
      event.source.sessionId != null ||
      event.source.targetId != null
    )
      return
    if (blocked(event)) {
      try {
        assertNavigationEvent(event)
      } catch (value) {
        error = value instanceof Error ? value : Error(String(value))
      }
    } else if (event.method === 'Page.frameNavigated' || event.method === 'Page.lifecycleEvent') {
      if (frame == null) {
        pending.push(event)
        return
      }
      if (event.method === 'Page.frameNavigated') {
        const next = event.params?.frame as { id: string; loaderId?: string; parentId?: string }
        if (next.parentId != null) return
        if (frame.id !== next.id || frame.loaderId !== next.loaderId) {
          frame = next
          idle = false
        }
      } else if (
        event.params?.name === 'networkIdle' &&
        event.params.frameId === frame.id &&
        event.params.loaderId === frame.loaderId
      )
        idle = true
    } else return
    wake()
  }
  const detach = (tabId: number) => {
    if (tabId === id) {
      error ??= Error(`Tab ${id} detached while waiting for networkidle.`)
      wake()
    }
  }
  cdp.on('event', event)
  cdp.on('tabDetached', detach)
  try {
    await cdp.call(id, 'Page.enable', {}, options)
    frame = ((await cdp.call(id, 'Page.getFrameTree', undefined, options)) as any).frameTree.frame
    for (const item of pending) event(item)
    pending.length = 0
    await cdp.call(id, 'Page.setLifecycleEventsEnabled', { enabled: true }, options)
    for (;;) {
      if (error != null) throw error
      if (Date.now() >= deadlineMs) throw timeout()
      if (idle) return
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await new Promise<void>((resolve) => {
          wake = resolve
          timer = setTimeout(resolve, deadlineMs - Date.now())
        })
      } finally {
        clearTimeout(timer)
      }
    }
  } catch (value) {
    throw error ?? (Date.now() >= deadlineMs ? timeout() : value)
  } finally {
    cdp.removeListener('event', event)
    cdp.removeListener('tabDetached', detach)
  }
}
export async function waitForLoadState(
  tabId: number | string,
  state: LoadState | undefined,
  timeoutMs: number,
  context: { cdp: WaitCdp }
) {
  const id = positiveTab(tabId),
    load = state ?? 'load',
    cdp = context.cdp
  if (load === 'networkidle') {
    await waitForNetworkIdle(cdp, id, timeoutMs)
    return
  }
  await cdp.call(id, 'Page.enable', {})
  const event = await cdp.waitForEvent(
    id,
    (event) =>
      top(event) &&
      (blocked(event) ||
        (load === 'domcontentloaded' && event.method === 'Page.domContentEventFired') ||
        event.method === 'Page.loadEventFired'),
    {
      timeoutMs,
      timeoutMessage: `Timed out waiting for ${load} in tab ${id}.`,
      initialCheck: async () => {
        const state = await cdp.readDocumentState(id)
        return (
          (load === 'domcontentloaded' && state?.readyState === 'interactive') ||
          state?.readyState === 'complete'
        )
      }
    }
  )
  assertNavigationEvent(event)
}
function positiveTab(input: number | string) {
  const value = Number(input)
  if (!Number.isInteger(value) || value <= 0) throw Error('Expected a positive integer')
  return value
}
export function urlPattern(pattern: string) {
  let source = '^'
  for (let index = 0; index < pattern.length; ) {
    const character = pattern[index]!
    if (character === '*') {
      const double = pattern[index + 1] === '*'
      source += double ? '.*' : '[^/]*'
      index += double ? 2 : 1
    } else {
      source += /[\\.^$|()[\]{}+?]/.test(character) ? `\\${character}` : character
      index++
    }
  }
  return source + '$'
}
function eventUrl(
  event: CdpEvent,
  frameId: string | undefined,
  matches: (value: string) => boolean
) {
  if (event.method === 'Page.navigatedWithinDocument') {
    if (frameId != null && event.params?.frameId !== frameId) return
    const url = event.params?.url
    return typeof url === 'string' && matches(url) ? url : undefined
  }
  if (event.method !== 'Page.frameNavigated') return
  const frame = event.params?.frame as { id?: string; parentId?: string; url?: string } | undefined
  if (frame == null || (frameId != null ? frame.id !== frameId : frame.parentId != null)) return
  return typeof frame.url === 'string' && matches(frame.url) ? frame.url : undefined
}
export async function waitForUrl(
  params: {
    tab_id: number | string
    url: string
    timeout_ms?: number
    wait_until?: LoadState | 'commit'
  },
  context: { cdp: WaitCdp }
) {
  if (typeof params.url !== 'string' || !params.url)
    throw Error('playwright_wait_for_url requires a url')
  const id = positiveTab(params.tab_id),
    timeoutMs = Math.min(
      Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 3000),
      3000
    ),
    pattern = new RegExp(urlPattern(params.url)),
    matches = (url: string) => pattern.test(url),
    cdp = context.cdp
  const wait = async () => {
    if (params.wait_until != null && params.wait_until !== 'commit')
      await waitForLoadState(id, params.wait_until, timeoutMs, context)
  }
  await cdp.call(id, 'Page.enable', {})
  let state = await cdp.readDocumentState(id)
  if (state?.href && matches(state.href)) {
    await wait()
    return { url: state.href }
  }
  let frameId: string | undefined
  try {
    frameId = ((await cdp.call(id, 'Page.getFrameTree')) as any).frameTree?.frame?.id
  } catch {}
  const event = await cdp.waitForEvent(
    id,
    (event) => top(event) && (blocked(event) || eventUrl(event, frameId, matches) != null),
    {
      timeoutMs,
      timeoutMessage: `Timed out waiting for URL ${params.url} in tab ${id}.`,
      initialCheck: async () => {
        state = await cdp.readDocumentState(id)
        return state?.href != null && matches(state.href)
      }
    }
  )
  assertNavigationEvent(event)
  const url = event ? eventUrl(event, frameId, matches) : state?.href
  await wait()
  return url == null ? {} : { url }
}
