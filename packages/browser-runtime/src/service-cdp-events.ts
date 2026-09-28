import { CdpFrames } from './service-cdp-frames.js'
import type { CdpTarget } from './service-cdp-execution.js'
export interface CdpEvent {
  source: CdpTarget
  method: string
  params?: Record<string, unknown>
}
interface RawEvent extends CdpEvent {
  sequence: number
  trackedTargetId?: string
}
interface RawOptions {
  afterSequence?: number
  timeoutMs?: number
  limit?: number
  methods?: string[]
  target?: { sessionId?: string; targetId?: string }
}
interface Dialog {
  id: string
  type: string
  message: string
  promptText: string
  target: CdpTarget
  url: string
}
interface Screencast {
  sessionIds: Set<number>
}
const topLevel = (event: CdpEvent) =>
  event.source.sessionId == null && event.source.targetId == null
const screencastId = (event: CdpEvent) =>
  typeof event.params?.sessionId === 'number' ? event.params.sessionId : undefined
export class CdpEventState extends CdpFrames {
  rawCdpEventsByTabId = new Map<number, RawEvent[]>()
  rawCdpEventEvictedThroughSequenceByTabId = new Map<number, number>()
  rawCdpEventSequenceByTabId = new Map<number, number>()
  suppressedRawNetworkByTab = new Map<number, number>()
  browserAuthCredentialDiagnosticsTabs = new Set<number>()
  activeInternalScreencastsByTabId = new Map<number, Screencast>()
  screencastQueuesByTabId = new Map<number, Promise<void>>()
  rawScreencastTabIds = new Set<number>()
  retiredInternalScreencastSessionsByTabId = new Map<number, Map<number, { expiresAt: number }>>()
  mainFrameIdsByTabId = new Map<number, string>()
  topLevelSecurityOriginsByTabId = new Map<number, string>()
  topLevelUrlsByTabId = new Map<number, string>()
  jsDialogsByTabId = new Map<number, Dialog>()
  jsDialogSequence = 0
  currentTopLevelUrl(input: number | string) {
    const id = Number(input)
    if (Number.isFinite(id)) return this.topLevelUrlsByTabId.get(id)
  }
  suppressRawNetworkEvents(id: number) {
    this.suppressedRawNetworkByTab.set(id, (this.suppressedRawNetworkByTab.get(id) ?? 0) + 1)
    let active = true
    return () => {
      if (!active) return
      active = false
      const count = this.suppressedRawNetworkByTab.get(id) ?? 0
      if (count <= 1) this.suppressedRawNetworkByTab.delete(id)
      else this.suppressedRawNetworkByTab.set(id, count - 1)
    }
  }
  hasBrowserAuthRawEventProtection(id: number) {
    return (
      this.suppressedRawNetworkByTab.has(id) || this.browserAuthCredentialDiagnosticsTabs.has(id)
    )
  }
  protectBrowserAuthCredentialDiagnostics(id: number) {
    this.browserAuthCredentialDiagnosticsTabs.add(id)
  }
  attachedTabIdForCdpEvent(source: Partial<CdpTarget>) {
    if (typeof source.tabId === 'number')
      return this.attachedTabIds.has(source.tabId) ? source.tabId : undefined
    if (source.sessionId != null)
      return this.frameSessionsBySessionId.get(source.sessionId)?.target.tabId
    if (source.targetId != null)
      for (const [id, frames] of this.frameSessionsByTabId)
        if (frames.has(source.targetId)) return id
  }
  rawCdpEventSequenceForTab(id: number) {
    return this.rawCdpEventSequenceByTabId.get(id) ?? 0
  }
  nextRawCdpEventSequence(id: number) {
    const next = this.rawCdpEventSequenceForTab(id) + 1
    this.rawCdpEventSequenceByTabId.set(id, next)
    return next
  }
  recordRawCdpEvent(id: number, event: CdpEvent) {
    const targetId =
        event.source.targetId ??
        (event.source.sessionId == null
          ? undefined
          : this.frameSessionsBySessionId.get(event.source.sessionId)?.targetId),
      raw: RawEvent = {
        method: event.method,
        ...(event.params == null
          ? {}
          : { params: Object.fromEntries(Object.entries(event.params)) }),
        sequence: this.nextRawCdpEventSequence(id),
        source: event.source,
        ...(targetId == null ? {} : { trackedTargetId: targetId })
      },
      events = this.rawCdpEventsByTabId.get(id) ?? []
    events.push(raw)
    if (events.length > 1000) {
      const evicted = events.splice(0, events.length - 1000).at(-1)
      if (evicted !== undefined)
        this.rawCdpEventEvictedThroughSequenceByTabId.set(id, evicted.sequence)
    }
    this.rawCdpEventsByTabId.set(id, events)
  }
  matchesRawCdpEventTarget(event: RawEvent, target: RawOptions['target']) {
    return target?.sessionId != null
      ? event.source.sessionId === target.sessionId
      : target?.targetId == null
        ? true
        : event.source.targetId === target.targetId || event.trackedTargetId === target.targetId
  }
  rawCdpEventsResult(id: number, after: number, options: RawOptions) {
    const matching = (this.rawCdpEventsByTabId.get(id) ?? []).filter(
        (event) =>
          event.sequence > after &&
          (options.methods == null || options.methods.includes(event.method)) &&
          this.matchesRawCdpEventTarget(event, options.target)
      ),
      events = matching
        .slice(0, options.limit ?? matching.length)
        .map((event) => ({
          method: event.method,
          ...(event.params == null ? {} : { params: event.params }),
          sequence: event.sequence,
          source: event.source
        })),
      hasMore = matching.length > events.length,
      last = events.at(-1)
    return {
      cursor: hasMore && last !== undefined ? last.sequence : this.rawCdpEventSequenceForTab(id),
      events,
      hasMore,
      truncated: after < (this.rawCdpEventEvictedThroughSequenceByTabId.get(id) ?? 0)
    }
  }
  async readRawCdpEvents(input: number | string, options: RawOptions = {}) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('readRawCdpEvents requires numeric tab_id')
    const initial =
      options.afterSequence ??
      (options.timeoutMs == null ? undefined : this.rawCdpEventSequenceForTab(id))
    await this.ensureAttachedTab(id)
    const after = initial ?? this.rawCdpEventSequenceForTab(id),
      result = this.rawCdpEventsResult(id, after, options)
    if (
      result.events.length > 0 ||
      result.truncated ||
      options.timeoutMs == null ||
      options.timeoutMs <= 0
    )
      return result
    return await new Promise<typeof result>((resolve) => {
      let completed = false
      const finish = () => {
          if (completed) return
          completed = true
          this.removeListener('event', event)
          this.removeListener('tabDetached', detached)
          clearTimeout(timer)
          resolve(this.rawCdpEventsResult(id, after, options))
        },
        event = () => {
          const current = this.rawCdpEventsResult(id, after, options)
          if (current.events.length > 0 || current.truncated) finish()
        },
        detached = (tabId: number) => {
          if (tabId === id) finish()
        },
        timer = setTimeout(finish, options.timeoutMs)
      this.addListener('event', event)
      this.addListener('tabDetached', detached)
      event()
    })
  }
  rawCdpTarget(id: number, target: RawOptions['target']): CdpTarget {
    if (target?.sessionId != null && target.targetId != null)
      throw Error('CDP target must provide either sessionId or targetId, not both.')
    if (target?.sessionId != null) {
      const session = this.frameSessionsBySessionId.get(target.sessionId)
      if (session?.target.tabId !== id)
        throw Error(`CDP session ${target.sessionId} is not attached to tab ${id}.`)
      return session.target
    }
    if (target?.targetId != null) {
      const session = this.frameSessionsByTabId.get(id)?.get(target.targetId)
      if (session === undefined)
        throw Error(`CDP target ${target.targetId} is not attached to tab ${id}.`)
      return session.target
    }
    return { tabId: id }
  }
  discardRawCdpEventsForTab(id: number) {
    const sequence = this.rawCdpEventSequenceForTab(id)
    if (sequence > 0)
      this.rawCdpEventEvictedThroughSequenceByTabId.set(
        id,
        Math.max(sequence, this.rawCdpEventEvictedThroughSequenceByTabId.get(id) ?? 0)
      )
    this.rawCdpEventsByTabId.delete(id)
  }
  getJsDialog(input: number | string) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('getJsDialog requires numeric tab_id')
    const dialog = this.jsDialogsByTabId.get(id)
    if (dialog !== undefined) return { id: dialog.id, type: dialog.type }
  }
  activeJsDialog(input: number | string, dialogId: string) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('handleJsDialog requires numeric tab_id')
    if (!dialogId) throw Error('handleJsDialog requires a dialog_id')
    const dialog = this.jsDialogsByTabId.get(id)
    if (dialog === undefined || dialog.id !== dialogId)
      throw Error('JavaScript dialog is no longer active')
    return dialog
  }
  updateJsDialogPrompt(id: number | string, dialogId: string, text: string) {
    const dialog = this.activeJsDialog(id, dialogId)
    if (dialog.type !== 'prompt') throw Error('Only prompt dialogs accept text')
    dialog.promptText = text
  }
  deleteJsDialog(input: number | string, dialogId: string) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('handleJsDialog requires numeric tab_id')
    if (!dialogId) throw Error('handleJsDialog requires a dialog_id')
    if (this.jsDialogsByTabId.get(id)?.id === dialogId) this.jsDialogsByTabId.delete(id)
  }
  rememberJsDialog(event: CdpEvent) {
    const id = this.attachedTabIdForCdpEvent(event.source)
    if (id === undefined) return
    const type = event.params?.type
    if (typeof type !== 'string' || !['alert', 'beforeunload', 'confirm', 'prompt'].includes(type))
      return
    this.jsDialogsByTabId.set(id, {
      id: this.nextJsDialogId(),
      message: (event.params?.message ?? '') as string,
      promptText: (event.params?.defaultPrompt ?? '') as string,
      target:
        typeof event.source.sessionId === 'string'
          ? { tabId: id, sessionId: event.source.sessionId }
          : { tabId: id },
      type,
      url: (event.params?.url ?? '') as string
    })
  }
  nextJsDialogId() {
    return String(++this.jsDialogSequence)
  }
  handleJavaScriptDialogEvent(event: CdpEvent) {
    if (event.method === 'Page.javascriptDialogOpening') {
      const id = this.attachedTabIdForCdpEvent(event.source)
      if (id !== undefined && this.hasBrowserAuthRawEventProtection(id)) {
        const target =
          typeof event.source.sessionId === 'string'
            ? { tabId: id, sessionId: event.source.sessionId }
            : { tabId: id }
        void this.callTarget(target, 'Page.handleJavaScriptDialog', {
          accept: event.params?.type === 'alert'
        }).catch(() => {})
        return
      }
      this.rememberJsDialog(event)
      if (event.params?.type === 'beforeunload') void this.allowBeforeUnload(event)
      return
    }
    if (event.method === 'Page.javascriptDialogClosed') this.deleteJsDialogForTarget(event.source)
  }
  async allowBeforeUnload(event: CdpEvent) {
    const id = this.attachedTabIdForCdpEvent(event.source)
    if (id === undefined) return
    const target =
      typeof event.source.sessionId === 'string'
        ? { tabId: id, sessionId: event.source.sessionId }
        : { tabId: id }
    await this.callTarget(target, 'Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
  }
  deleteJsDialogForTarget(source: CdpTarget) {
    const id = this.attachedTabIdForCdpEvent(source)
    if (id === undefined) return
    const dialog = this.jsDialogsByTabId.get(id)
    if (
      dialog !== undefined &&
      (dialog.target.sessionId != null
        ? dialog.target.sessionId === source.sessionId
        : dialog.target.tabId === source.tabId && source.sessionId == null)
    )
      this.jsDialogsByTabId.delete(id)
  }
  throwIfJsDialogBlocksMethod(id: number, method: string) {
    if (method === 'Page.handleJavaScriptDialog') return
    const dialog = this.jsDialogsByTabId.get(id)
    if (dialog !== undefined)
      throw Error(
        `A ${dialog.type} JavaScript dialog is active in this tab. Use \`tab.getJsDialog()\` to get it and dismiss it first.`
      )
  }
  protected override assertMethodAllowed(id: number, method: string) {
    this.throwIfJsDialogBlocksMethod(id, method)
  }
  protected override clearFrameDialog(id: number, sessionId: string) {
    if (this.jsDialogsByTabId.get(id)?.target.sessionId === sessionId)
      this.jsDialogsByTabId.delete(id)
  }
  async withScreencastLock<T>(id: number, run: () => Promise<T>) {
    const previous = this.screencastQueuesByTabId.get(id) ?? Promise.resolve()
    let release!: () => void
    const lock = new Promise<void>((resolve) => {
        release = resolve
      }),
      queued = previous.then(() => lock)
    this.screencastQueuesByTabId.set(id, queued)
    await previous
    try {
      return await run()
    } finally {
      release()
      if (this.screencastQueuesByTabId.get(id) === queued) this.screencastQueuesByTabId.delete(id)
    }
  }
  async withInternalScreencast<T>(
    input: number | string,
    run: (matches: (event: CdpEvent) => boolean) => Promise<T>
  ) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('withInternalScreencast requires numeric tab_id')
    return await this.withScreencastLock(id, async () => {
      if (this.rawScreencastTabIds.has(id)) return
      const state: Screencast = { sessionIds: new Set() }
      this.activeInternalScreencastsByTabId.set(id, state)
      try {
        return await run((event) => this.isCurrentInternalScreencastEvent(id, state, event))
      } finally {
        if (this.activeInternalScreencastsByTabId.get(id) === state)
          this.activeInternalScreencastsByTabId.delete(id)
        this.retireInternalScreencast(id, state)
      }
    })
  }
  isInternalScreencastEvent(id: number, event: CdpEvent) {
    if (!topLevel(event)) return false
    const active = this.activeInternalScreencastsByTabId.get(id)
    if (event.method === 'Page.screencastVisibilityChanged') return active !== undefined
    if (event.method !== 'Page.screencastFrame') return false
    const sessionId = screencastId(event)
    if (sessionId != null && this.activeRetiredInternalScreencastSessions(id).has(sessionId))
      return true
    if (active === undefined) return false
    if (sessionId != null) active.sessionIds.add(sessionId)
    return true
  }
  isCurrentInternalScreencastEvent(id: number, state: Screencast, event: CdpEvent) {
    if (this.activeInternalScreencastsByTabId.get(id) !== state || !topLevel(event)) return false
    if (event.method === 'Page.screencastVisibilityChanged') return true
    if (event.method !== 'Page.screencastFrame') return false
    const sessionId = screencastId(event)
    return sessionId != null && state.sessionIds.has(sessionId)
  }
  activeRetiredInternalScreencastSessions(id: number) {
    const sessions =
        this.retiredInternalScreencastSessionsByTabId.get(id) ??
        new Map<number, { expiresAt: number }>(),
      now = Date.now()
    for (const [session, data] of sessions) if (data.expiresAt <= now) sessions.delete(session)
    if (sessions.size === 0) this.retiredInternalScreencastSessionsByTabId.delete(id)
    return sessions
  }
  retireInternalScreencast(id: number, state: Screencast) {
    if (state.sessionIds.size === 0) return
    const sessions = this.activeRetiredInternalScreencastSessions(id),
      expiresAt = Date.now() + 10000
    for (const session of state.sessionIds) sessions.set(session, { expiresAt })
    while (sessions.size > 32) {
      const first = sessions.keys().next().value
      if (first == null) break
      sessions.delete(first)
    }
    this.retiredInternalScreencastSessionsByTabId.set(id, sessions)
  }
  protected override clearTabState(id: number) {
    super.clearTabState(id)
    this.jsDialogsByTabId.delete(id)
    this.discardRawCdpEventsForTab(id)
    this.rawScreencastTabIds.delete(id)
    this.retiredInternalScreencastSessionsByTabId.delete(id)
    this.mainFrameIdsByTabId.delete(id)
    this.topLevelSecurityOriginsByTabId.delete(id)
    this.topLevelUrlsByTabId.delete(id)
  }
}
