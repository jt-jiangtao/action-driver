import { CdpExecutor, withinCdpDeadline } from './service-cdp-execution.js'
import type { CdpTarget, CdpExecutionApi } from './service-cdp-execution.js'
import { assertCdpDeadline, cdpTimeout, isCdpDeadlineError } from './service-cdp-attachment.js'
import type { CdpOptions } from './service-cdp-attachment.js'
export interface FrameSession {
  frameId: string | null
  sessionId: string
  target: CdpTarget
  targetId: string
}
interface FrameApi extends CdpExecutionApi {
  attachTarget?: (tabId: number, targetId: string) => Promise<unknown>
  detachTarget?: (tabId: number, targetId: string) => Promise<unknown>
}
interface TargetInfo {
  targetId?: string
  id?: string
  type: string
  url?: string
  tabId?: number
}
export interface FrameEvent {
  source: CdpTarget
  params: { targetInfo?: TargetInfo; sessionId?: string; frame?: { id: string }; frameId?: string }
}
const targetId = (info: TargetInfo | undefined) =>
  typeof info?.targetId === 'string'
    ? info.targetId
    : typeof info?.id === 'string'
      ? info.id
      : undefined
export class CdpFrames extends CdpExecutor {
  declare protected api: FrameApi
  frameSessionsByTabId = new Map<number, Map<string | undefined, FrameSession>>()
  frameSessionsBySessionId = new Map<string, FrameSession>()
  initializedFrameSessions = new WeakSet<FrameSession>()
  frameSessionInitializationPromises = new WeakMap<FrameSession, Promise<void>>()
  attachedFrameTargetIdsByTabId = new Map<number, Set<string>>()
  oopifAutoAttachTabIds = new Set<number>()
  targetForFrame(input: number | string, frameId: string) {
    const id = Number(input)
    return Number.isFinite(id)
      ? (this.frameSessionsByTabId.get(id)?.get(frameId)?.target ?? null)
      : null
  }
  targetIdForFrame(input: number | string, frameId: string) {
    const id = Number(input)
    return Number.isFinite(id)
      ? (this.frameSessionsByTabId.get(id)?.get(frameId)?.targetId ?? null)
      : null
  }
  async targetForFrameOrAttach(
    input: number | string,
    frameId: string | null | undefined,
    options: CdpOptions = {},
    hints: { url?: string; parentTarget?: CdpTarget } = {}
  ) {
    const id = Number(input)
    if (!Number.isFinite(id)) return null
    if (frameId != null) {
      const existing = this.frameSessionsByTabId.get(id)?.get(frameId)
      if (existing !== undefined) {
        await this.tryInitializeAttachedFrameSession(existing, options)
        return existing.target
      }
    }
    assertCdpDeadline(options)
    await this.ensureAttachedTab(id)
    const response = (await this.callTarget({ tabId: id }, 'Target.getTargets', {}, options).catch(
      () => null
    )) as { targetInfos: TargetInfo[] } | null
    assertCdpDeadline(options)
    const targets =
        response?.targetInfos.filter(
          (info) => !('tabId' in info) || info.tabId == null || info.tabId === id
        ) ?? [],
      exact = targets.find(
        (info) => ['iframe', 'other'].includes(info.type) && targetId(info) === frameId
      ),
      eligible = targets.filter(
        (info) =>
          info.type === 'iframe' ||
          (info.type === 'other' && hints.url != null && info.url === hints.url)
      ),
      matching = hints.url == null ? [] : eligible.filter((info) => info.url === hints.url),
      selected = exact ?? (matching.length === 1 ? matching[0] : undefined),
      target = targetId(selected)
    if (selected == null || target == null) return null
    if (
      exact == null &&
      !('tabId' in selected && selected.tabId === id) &&
      this.frameSessionsByTabId.get(id)?.has(target) !== true
    ) {
      const parent = hints.parentTarget ?? { tabId: id }
      if (parent.tabId !== id) return null
      const owner = (await this.callTarget(
        parent,
        'DOM.getFrameOwner',
        { frameId: target },
        options
      ).catch(() => null)) as { backendNodeId?: number } | null
      assertCdpDeadline(options)
      if (typeof owner?.backendNodeId !== 'number') return null
    }
    return (
      (await this.attachDebuggerFrameTarget(id, target, frameId ?? undefined, options)) ??
      (frameId == null ? null : this.targetForFrame(id, frameId))
    )
  }
  async enableOopifAutoAttach(input: number | string, options: CdpOptions = {}) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('enableOopifAutoAttach requires numeric tab_id')
    if (this.oopifAutoAttachTabIds.has(id)) return
    assertCdpDeadline(options)
    await withinCdpDeadline(this.ensureAttachedTab(id, { timeoutMs: cdpTimeout(options) }), options)
    if (!this.oopifAutoAttachTabIds.has(id)) {
      await this.enableOopifAutoAttachForTarget({ tabId: id }, options)
      this.oopifAutoAttachTabIds.add(id)
    }
  }
  async enableOopifAutoAttachForTarget(target: CdpTarget, options: CdpOptions = {}) {
    const params = { autoAttach: true, flatten: true, waitForDebuggerOnStart: false },
      timeout = () => {
        options.beforeDispatch?.()
        return cdpTimeout(options)
      }
    try {
      await this.api.executeCdp({
        target,
        method: 'Target.setAutoAttach',
        commandParams: { ...params, filter: [{ type: 'iframe', exclude: false }] },
        timeoutMs: timeout()
      })
    } catch (error) {
      if (isCdpDeadlineError(error)) throw error
      try {
        await this.api.executeCdp({
          target,
          method: 'Target.setAutoAttach',
          commandParams: params,
          timeoutMs: timeout()
        })
      } catch (fallback) {
        if (isCdpDeadlineError(fallback)) throw fallback
        assertCdpDeadline(options)
      }
    }
  }
  async attachDebuggerFrameTarget(
    id: number,
    targetId: string,
    frameId: string | undefined,
    options: CdpOptions
  ) {
    const key = `target:${targetId}`,
      existing =
        this.frameSessionsByTabId.get(id)?.get(targetId) ?? this.frameSessionsBySessionId.get(key)
    if (existing !== undefined) {
      if (existing.target.tabId !== id) return null
      if (frameId != null) this.setFrameSessionForFrame(id, frameId, existing)
      await this.tryInitializeAttachedFrameSession(existing, options)
      return existing.target
    }
    if (typeof this.api.attachTarget !== 'function') return null
    assertCdpDeadline(options)
    try {
      await this.api.attachTarget(id, targetId)
    } catch {
      assertCdpDeadline(options)
      return null
    }
    const session = this.frameSessionsByTabId.get(id)?.get(targetId) ??
      this.frameSessionsBySessionId.get(key) ?? {
        frameId: null,
        sessionId: key,
        target: { tabId: id, targetId },
        targetId
      }
    this.frameSessionsBySessionId.set(session.sessionId, session)
    this.setFrameSessionTargetId(id, targetId, session)
    this.setFrameSessionForFrame(id, frameId ?? targetId, session)
    this.rememberAttachedFrameTarget(id, targetId)
    assertCdpDeadline(options)
    await this.tryInitializeAttachedFrameSession(session, options)
    return session.target
  }
  handleAttachedToTarget(event: FrameEvent) {
    const id = event.source.tabId,
      info = event.params.targetInfo,
      sessionId = event.params.sessionId
    if (
      typeof id !== 'number' ||
      typeof sessionId !== 'string' ||
      !info ||
      !['iframe', 'other'].includes(info.type)
    )
      return
    const target = targetId(info)
    if (target === undefined) return
    const existing = this.frameSessionsBySessionId.get(sessionId)
    if (existing !== undefined) {
      this.setFrameSessionTargetId(id, target, existing)
      return
    }
    const session: FrameSession = {
      frameId: null,
      sessionId,
      target: { tabId: id, sessionId },
      targetId: target
    }
    this.frameSessionsBySessionId.set(sessionId, session)
    this.setFrameSessionTargetId(id, target, session)
  }
  handleDetachedFromTarget(event: FrameEvent) {
    const session = this.frameSessionsBySessionId.get(event.params.sessionId!)
    if (session !== undefined) this.deleteFrameSession(session)
  }
  handleFrameNavigated(event: FrameEvent) {
    const id = event.source.tabId,
      sessionId = event.source.sessionId,
      frameId = event.params.frame!.id
    if (typeof id !== 'number' || typeof sessionId !== 'string') return
    const session = this.frameSessionsBySessionId.get(sessionId)
    if (session !== undefined && (session.frameId === null || session.frameId === frameId))
      this.setFrameSessionForFrame(id, frameId, session)
  }
  handleFrameDetached(event: FrameEvent) {
    const id = event.source.tabId
    if (typeof id !== 'number') return
    const session = this.frameSessionsByTabId.get(id)?.get(event.params.frameId)
    if (session !== undefined) this.deleteFrameSession(session)
  }
  async initializeAttachedFrameSession(session: FrameSession, options: CdpOptions = {}) {
    if (this.initializedFrameSessions.has(session)) return
    const pending = this.frameSessionInitializationPromises.get(session)
    if (pending !== undefined) {
      try {
        assertCdpDeadline(options)
        await withinCdpDeadline(pending, options)
        return
      } catch {
        assertCdpDeadline(options)
        await this.initializeAttachedFrameSession(session, options)
        return
      }
    }
    assertCdpDeadline(options)
    const request = this.runAttachedFrameSessionInitialization(session, options)
      .then(() => {
        this.initializedFrameSessions.add(session)
      })
      .finally(() => {
        if (this.frameSessionInitializationPromises.get(session) === request)
          this.frameSessionInitializationPromises.delete(session)
      })
    this.frameSessionInitializationPromises.set(session, request)
    await withinCdpDeadline(request, options)
  }
  async tryInitializeAttachedFrameSession(session: FrameSession, options: CdpOptions) {
    await this.initializeAttachedFrameSession(session, options).catch(() => {})
    assertCdpDeadline(options)
  }
  async runAttachedFrameSessionInitialization(session: FrameSession, options: CdpOptions = {}) {
    const timeout = () => {
      options.beforeDispatch?.()
      return cdpTimeout(options)
    }
    await this.api.executeCdp({
      target: session.target,
      method: 'Page.enable',
      commandParams: {},
      timeoutMs: timeout()
    })
    await this.api.executeCdp({
      target: session.target,
      method: 'Runtime.enable',
      commandParams: {},
      timeoutMs: timeout()
    })
    const result = (await this.api.executeCdp({
      target: session.target,
      method: 'Page.getFrameTree',
      commandParams: {},
      timeoutMs: timeout()
    })) as { frameTree: { frame: { id: string } } }
    if (this.frameSessionsBySessionId.get(session.sessionId) !== session) return
    this.setFrameSessionForFrame(session.target.tabId, result.frameTree.frame.id, session)
  }
  setFrameSessionForFrame(id: number, frameId: string | undefined, session: FrameSession) {
    const frames = this.frameSessionsByTabId.get(id) ?? new Map()
    this.frameSessionsByTabId.set(id, frames)
    if (
      session.frameId !== null &&
      session.frameId !== frameId &&
      session.frameId !== session.targetId
    )
      frames.delete(session.frameId)
    session.frameId = frameId as string
    frames.set(frameId, session)
  }
  setFrameSessionTargetId(id: number, targetId: string, session: FrameSession) {
    const frames = this.frameSessionsByTabId.get(id) ?? new Map()
    this.frameSessionsByTabId.set(id, frames)
    if (session.targetId !== targetId && session.targetId !== session.frameId)
      frames.delete(session.targetId)
    session.targetId = targetId
    frames.set(targetId, session)
  }
  deleteFrameSession(session: FrameSession) {
    this.frameSessionsBySessionId.delete(session.sessionId)
    this.clearFrameDialog(session.target.tabId, session.sessionId)
    const frames = this.frameSessionsByTabId.get(session.target.tabId)
    if (session.frameId !== null) frames?.delete(session.frameId)
    frames?.delete(session.targetId)
  }
  protected clearFrameDialog(_id: number, _session: string): void {}
  deleteFrameSessionsForTab(id: number) {
    const frames = this.frameSessionsByTabId.get(id)
    if (frames !== undefined) {
      for (const frame of frames.values()) this.frameSessionsBySessionId.delete(frame.sessionId)
      this.frameSessionsByTabId.delete(id)
    }
  }
  rememberAttachedFrameTarget(id: number, target: string) {
    const targets = this.attachedFrameTargetIdsByTabId.get(id) ?? new Set<string>()
    this.attachedFrameTargetIdsByTabId.set(id, targets)
    targets.add(target)
  }
  async detachAttachedFrameTargets(id: number) {
    const targets = this.attachedFrameTargetIdsByTabId.get(id)
    if (targets === undefined) return
    this.attachedFrameTargetIdsByTabId.delete(id)
    if (typeof this.api.detachTarget === 'function')
      await Promise.allSettled([...targets].map((target) => this.api.detachTarget!(id, target)))
  }
  protected override clearTabState(id: number) {
    super.clearTabState(id)
    this.deleteFrameSessionsForTab(id)
    this.oopifAutoAttachTabIds.delete(id)
  }
}
