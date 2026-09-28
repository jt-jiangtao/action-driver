import type { BrowserCdp } from './service-cdp.js'
import type { CdpEvent } from './service-cdp-events.js'
import { BrowserUseSecurityError } from './service-security-approval.js'
import { assertNavigationEvent } from './service-page-waits.js'
interface Frame {
  id: string
  loaderId?: string
  url?: string
  parentId?: string
}
interface Navigation {
  frameId?: string
  loaderId?: string
  errorText?: string
  isDownload?: boolean
}
interface Context {
  cdp: Pick<BrowserCdp, 'call' | 'readDocumentState' | 'waitForEvent' | 'on' | 'removeListener'>
  documentResponses: object
  followSessionTab(id: number): Promise<unknown>
  getCurrentSessionId(): string | undefined
  security: {
    ensureCommandAllowed(command: { type: string; params: { url: string } }): Promise<unknown>
  }
  credentialObservationGate?: {
    epoch: number
    permitNavigatedDocument(id: number, loaderId: string, epoch: number): unknown
  }
}
interface OwnedDocument {
  close(): Promise<unknown>
  navigateToBrowserBlank(): Promise<unknown>
}
const ownedDocuments = new WeakMap<object, Map<number, OwnedDocument>>()
export function registerAuthDocument(responses: object, id: number, document: OwnedDocument) {
  const records = ownedDocuments.get(responses) ?? new Map<number, OwnedDocument>()
  ownedDocuments.set(responses, records)
  records.set(id, document)
  return () => {
    if (records.get(id) === document) records.delete(id)
  }
}
export async function closeAuthDocument(responses: object, id: number) {
  await ownedDocuments.get(responses)?.get(id)?.close()
}
const normalized = (url: unknown) => {
  if (typeof url !== 'string') return undefined
  try {
    return new URL(url).href
  } catch {
    return url
  }
}
const main = (event: CdpEvent) => event.source.sessionId == null
const frameEvent = (event: CdpEvent, id: string | undefined) =>
  event.method === 'Page.frameNavigated' &&
  event.params?.frame != null &&
  (id != null
    ? (event.params.frame as Frame).id === id
    : !('parentId' in (event.params.frame as Frame)))
const loaded = (event: CdpEvent) =>
  event.method === 'Page.domContentEventFired' || event.method === 'Page.loadEventFired'
const blocked = (event: CdpEvent) =>
  event.method === 'Page.navigationBlocked' && event.params?.resourceType !== 'subFrame'
function displayUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return 'this page'
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.pathname === '/' ? url.toString().slice(0, -1) : url.toString()
  } catch {
    return 'this page'
  }
}
async function readFrame(context: Context, id: number) {
  try {
    return ((await context.cdp.call(id, 'Page.getFrameTree')) as { frameTree?: { frame: Frame } })
      .frameTree?.frame
  } catch {
    return undefined
  }
}
async function restore(
  context: Context,
  id: number,
  entry: { id: number; url: string },
  frameId: string | undefined,
  timeoutMs: number,
  guard: () => void
) {
  const abort = new AbortController(),
    url = normalized(entry.url)
  let navigated = false
  const wait = context.cdp.waitForEvent(
    id,
    (event) => {
      if (!main(event) || event.source.targetId != null) return false
      if (event.method === 'Page.navigatedWithinDocument')
        return (
          frameId != null &&
          event.params?.frameId === frameId &&
          normalized(event.params.url) === url
        )
      if (frameEvent(event, undefined))
        navigated = normalized((event.params!.frame as Frame).url) === url
      return navigated && loaded(event)
    },
    {
      timeoutMs,
      timeoutMessage: 'Timed out restoring the previous page after blocked navigation.',
      signal: abort.signal
    }
  )
  void wait.catch(() => {})
  try {
    await context.cdp.call(
      id,
      'Page.navigateToHistoryEntry',
      { entryId: entry.id },
      { timeoutMs, beforeDispatch: guard }
    )
    await wait
  } finally {
    abort.abort()
  }
}
export async function navigateTabUrl(
  params: { tab_id: string | number; url: string; timeout_ms?: number },
  context: Context,
  approval: Promise<unknown>
) {
  const id = Number(params.tab_id)
  await context.followSessionTab(id)
  const owned = ownedDocuments.get(context.documentResponses)?.get(id)
  if (owned != null) {
    await approval
    await owned.navigateToBrowserBlank()
  }
  const url = params.url,
    timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : 10000,
    abort = new AbortController(),
    epoch = context.credentialObservationGate?.epoch
  void approval.catch(() => abort.abort())
  const session = context.getCurrentSessionId(),
    state = await context.cdp.readDocumentState(id),
    previousUrl = normalized(state?.href),
    targetUrl = normalized(url)
  await context.cdp.call(id, 'Page.enable', {})
  const previous = await readFrame(context, id),
    mainId = previous?.id
  let navigated = false
  const changedUrl = (value: unknown) => {
    const current = normalized(value)
    return current == null
      ? false
      : (targetUrl != null && current === targetUrl) ||
          (previousUrl != null && current !== previousUrl)
        ? true
        : previousUrl == null && targetUrl == null
  }
  const predicate = (event: CdpEvent) => {
    if (event.method === 'Page.navigatedWithinDocument') return changedUrl(event.params?.url)
    if (frameEvent(event, mainId) && changedUrl((event.params!.frame as Frame).url))
      navigated = true
    if (
      event.method === 'Page.frameStartedLoading' &&
      mainId != null &&
      event.params?.frameId === mainId
    )
      navigated = true
    return navigated && loaded(event)
  }
  const history = (await context.cdp
      .call(id, 'Page.getNavigationHistory')
      .catch(() => undefined)) as
      | { entries: { id: number; url: string }[]; currentIndex: number }
      | undefined,
    entry = history?.entries[history.currentIndex]
  let frame = previous,
    started: Record<string, unknown> | undefined,
    within = 0,
    detached = false,
    response: Navigation | undefined
  const listener = (event: CdpEvent) => {
      if (
        event.source.tabId !== id ||
        event.source.sessionId != null ||
        event.source.targetId != null
      )
        return
      if (event.method === 'Page.frameStartedNavigating' && event.params?.frameId === mainId)
        started = event.params
      if (
        event.method === 'Page.frameNavigated' &&
        (event.params?.frame as Frame)?.parentId == null
      )
        frame = event.params?.frame as Frame
      if (event.method === 'Page.navigatedWithinDocument' && event.params?.frameId === frame?.id) {
        within++
        frame = { ...frame!, url: event.params!.url as string }
      }
    },
    detach = (tabId: number) => {
      if (tabId === id) detached = true
    }
  const matches = () => {
    if (
      detached ||
      context.getCurrentSessionId() !== session ||
      frame == null ||
      response?.frameId !== frame.id ||
      response.errorText ||
      response.isDownload === true
    )
      return false
    const same =
      started?.navigationType === 'sameDocument' ||
      started?.navigationType === 'historySameDocument'
    return response.loaderId != null
      ? frame.loaderId === response.loaderId &&
          (started == null || same || started.loaderId === response.loaderId)
      : previous != null && frame.loaderId === previous.loaderId && (started == null || same)
  }
  const guard = () => {
    if (!matches()) throw Error('The tab changed before history restoration.')
    const count = response?.loaderId == null ? 1 : 0
    if (within !== count || (count === 1 && normalized(frame?.url) !== targetUrl))
      throw Error('The tab navigated again before history restoration.')
  }
  const refresh = async () => {
    const current = frame,
      next = await readFrame(context, id)
    if (frame === current) frame = next
  }
  context.cdp.on('event', listener)
  context.cdp.on('tabDetached', detach)
  const wait = context.cdp
    .waitForEvent(id, (event) => main(event) && (blocked(event) || predicate(event)), {
      timeoutMs,
      timeoutMessage: `Timed out waiting for tab ${id} to navigate to ${url}.`,
      signal: abort.signal
    })
    .then(
      (event) => ({ event }),
      (error) => (abort.signal.aborted ? { event: undefined } : { error })
    )
  try {
    const navigate = async () => {
      response = (await context.cdp.call(
        id,
        'Page.navigate',
        { url },
        {
          beforeDispatch: () => {
            if (abort.signal.aborted || detached || context.getCurrentSessionId() !== session)
              throw Error('The browser session changed before navigation started.')
            if (frame !== previous || started != null)
              throw Error('The tab changed before navigation started.')
          }
        }
      )) as Navigation
      if (response.errorText) {
        const display = displayUrl(url)
        throw Error(
          `Browser Use cannot open ${display} in tab ${id}. Browser reported: ${response.errorText.replaceAll(url, display)}`
        )
      }
      const result = await wait
      if ('error' in result) throw result.error
      assertNavigationEvent(result.event)
    }
    const [permission, result] = await Promise.allSettled([approval, navigate()])
    if (permission.status === 'rejected') {
      if (permission.reason instanceof BrowserUseSecurityError)
        try {
          await refresh()
          guard()
          await context.cdp.call(id, 'Page.stopLoading', undefined, {
            timeoutMs,
            beforeDispatch: guard
          })
          if (entry != null) {
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([
                context.security.ensureCommandAllowed({
                  type: 'navigate_tab_url',
                  params: { url: entry.url }
                }),
                new Promise((_, reject) => {
                  timer = setTimeout(
                    () => reject(Error('Timed out authorizing history restoration.')),
                    timeoutMs
                  )
                })
              ])
            } finally {
              clearTimeout(timer)
            }
            await restore(context, id, entry, frame?.id, timeoutMs, guard)
          }
        } catch {}
      throw permission.reason
    }
    if (result.status === 'rejected') throw result.reason
    if (epoch != null) {
      await refresh()
      if (
        !matches() ||
        response?.loaderId == null ||
        frame == null ||
        frame.loaderId === previous?.loaderId ||
        within !== 0
      )
        return {}
      context.credentialObservationGate!.permitNavigatedDocument(id, frame.loaderId!, epoch)
    }
  } finally {
    abort.abort()
    context.cdp.removeListener('event', listener)
    context.cdp.removeListener('tabDetached', detach)
  }
  return {}
}
