import { EventEmitter } from 'node:events'
export interface CdpOptions {
  timeoutMs?: number | undefined
  deadlineMs?: number | undefined
  beforeDispatch?: () => void
  prepareDispatch?: () => Promise<unknown>
  preserveDebuggerOnTimeout?: boolean
  expressionCacheKey?: string | undefined
  telemetryAttrs?: Record<string, unknown> | undefined
}
export const cdpDeadlineMessage = 'CDP operation exceeded its deadline before command dispatch'
export function assertCdpDeadline(options: CdpOptions) {
  if (options.deadlineMs != null && Date.now() >= options.deadlineMs)
    throw Error(cdpDeadlineMessage)
}
export function cdpTimeout(options: CdpOptions) {
  assertCdpDeadline(options)
  if (options.deadlineMs == null) return options.timeoutMs
  const remaining = options.deadlineMs - Date.now()
  return Math.max(1, Math.min(options.timeoutMs ?? remaining, remaining))
}
export function isCdpDeadlineError(error: unknown) {
  return /(?:deadline|timed out)/i.test(
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  )
}
export interface CdpAttachmentApi {
  attach(id: number): Promise<unknown>
  detach(id: number): Promise<unknown>
  executeCdp(params: {
    target: { tabId: number }
    method: string
    commandParams: Record<string, unknown>
    timeoutMs?: number | undefined
  }): Promise<unknown>
}
type AttachHandler = (id: number, options: CdpOptions) => Promise<unknown> | unknown
type CleanupHandler = (id: number) => Promise<unknown> | unknown
/** Shared attachment lifecycle. Concrete CDP manager registers page/frame initialization and cleanup. */
export class CdpAttachmentLifecycle extends EventEmitter {
  attachedTabIds = new Set<number>()
  tabAttachmentPromises = new Map<number, Promise<void>>()
  initializingTabIds = new Set<number>()
  tabAttachHandlers = new Set<AttachHandler>()
  tabCleanupHandlers = new Set<CleanupHandler>()
  constructor(protected api: CdpAttachmentApi) {
    super()
  }
  isTabAttached(id: number | string) {
    return this.attachedTabIds.has(Number(id))
  }
  addTabAttachHandler(handler: AttachHandler) {
    this.tabAttachHandlers.add(handler)
    return () => {
      this.tabAttachHandlers.delete(handler)
    }
  }
  addTabCleanupHandler(handler: CleanupHandler) {
    this.tabCleanupHandlers.add(handler)
    return () => {
      this.tabCleanupHandlers.delete(handler)
    }
  }
  async runTabAttachHandlers(id: number, options: CdpOptions) {
    const failed = (
      await Promise.allSettled(
        [...this.tabAttachHandlers].map(async (handler) => handler(id, options))
      )
    ).find((result) => result.status === 'rejected' && isCdpDeadlineError(result.reason))
    if (failed?.status === 'rejected') throw failed.reason
  }
  async runTabCleanupHandlers(id: number) {
    await Promise.allSettled([...this.tabCleanupHandlers].map(async (handler) => handler(id)))
  }
  async enableFocusEmulation(id: number, options: CdpOptions) {
    try {
      await this.api.executeCdp({
        target: { tabId: id },
        method: 'Emulation.setFocusEmulationEnabled',
        commandParams: { enabled: true },
        timeoutMs: cdpTimeout(options)
      })
    } catch (error) {
      if (isCdpDeadlineError(error)) throw error
    }
  }
  async ensureAttachedTab(id: number, options: CdpOptions = {}) {
    if (this.attachedTabIds.has(id)) return
    if (this.initializingTabIds.has(id)) throw 'Debugger unattached'
    let pending = this.tabAttachmentPromises.get(id)
    if (pending === undefined) {
      pending = (async () => {
        await this.api.attach(id)
        await this.enableFocusEmulation(id, options)
        if (this.tabAttachmentPromises.get(id) !== pending)
          throw Error('Debugger detached while attaching')
        this.attachedTabIds.add(id)
        this.initializingTabIds.add(id)
        try {
          this.emit('tabAttached', id)
          await this.runTabAttachHandlers(id, options)
        } finally {
          this.initializingTabIds.delete(id)
          if (!this.attachedTabIds.has(id)) this.forgetAttachedTab(id, true)
        }
        if (!this.attachedTabIds.has(id)) throw 'Debugger unattached'
      })()
      this.tabAttachmentPromises.set(id, pending)
    }
    try {
      await pending
    } catch (error) {
      if (this.tabAttachmentPromises.get(id) === pending) this.forgetAttachedTab(id)
      throw error
    }
  }
  forgetAttachedTab(id: number, force = false) {
    if (this.initializingTabIds.has(id)) {
      this.attachedTabIds.delete(id)
      return
    }
    this.tabAttachmentPromises.delete(id)
    if (!this.attachedTabIds.has(id) && !force) return
    this.clearTabState(id)
    this.attachedTabIds.delete(id)
    this.emit('tabDetached', id)
  }
  protected clearTabState(_id: number): void {}
  async detachTab(input: number | string) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('detachTab requires numeric tab_id')
    while (!this.attachedTabIds.has(id)) {
      const pending = this.tabAttachmentPromises.get(id)
      if (pending === undefined) return
      await pending.catch(() => {})
    }
    try {
      await this.runTabCleanupHandlers(id)
      await this.api.detach(id)
    } finally {
      this.forgetAttachedTab(id)
    }
  }
  async detachAllTabs() {
    await Promise.allSettled([...this.tabAttachmentPromises.keys()].map((id) => this.detachTab(id)))
  }
}
