import { BrowserUseSecurityError } from './service-security-approval.js'
import { CdpEventState } from './service-cdp-events.js'
import type { CdpEvent } from './service-cdp-events.js'
import type { CdpExecutionApi, CdpPerformanceSpan, CdpTarget } from './service-cdp-execution.js'
import type { CdpOptions } from './service-cdp-attachment.js'
import type { FrameEvent } from './service-cdp-frames.js'
export interface BrowserCdpApi extends CdpExecutionApi {
  addEventListener(name: string, listener: (event: any) => void): unknown
  attachTarget?: (id: number, target: string) => Promise<unknown>
  detachTarget?: (id: number, target: string) => Promise<unknown>
  browserAuthNewTargetProtection(params: Record<string, unknown>): Promise<unknown>
}
interface WorkerBypass {
  count: number
  enabled: boolean
  pending: Promise<void>
}
export class BrowserCdp extends CdpEventState {
  declare protected api: BrowserCdpApi
  fileChoosersById = new Map<string, { tabId: number; [key: string]: unknown }>()
  workerStartProtectionByTab = new Map<number, number>()
  browserAuthWorkerBypassByTab = new Map<number, WorkerBypass>()
  configuredWorkerStartProtection = new Set<number>()
  workerStartConfigurationByTab = new Map<number, Promise<void>>()
  constructor(
    api: BrowserCdpApi,
    public platform: 'darwin',
    span: CdpPerformanceSpan
  ) {
    super(api, span)
    api.addEventListener('onCDPDetach', (event) => {
      const id =
        this.attachedTabIdForCdpEvent(event) ??
        (typeof event.tabId === 'number' && this.tabAttachmentPromises.has(event.tabId)
          ? event.tabId
          : undefined)
      if (id !== undefined) this.forgetAttachedTab(id)
    })
    api.addEventListener('onCDPEvent', (event: CdpEvent) => {
      const id = this.attachedTabIdForCdpEvent(event.source)
      if (id === undefined) return
      if (!this.isInternalScreencastEvent(id, event) && !this.hasBrowserAuthRawEventProtection(id))
        this.recordRawCdpEvent(id, event)
      const normalized = { ...event, source: { ...event.source, tabId: id } }
      this.handleTargetEvent(normalized)
      this.emit('event', normalized)
    })
    this.addTabAttachHandler(async (id, options) => {
      await this.call(id, 'Page.enable', undefined, options)
      await this.enableOopifAutoAttach(id, options)
    })
    this.addTabCleanupHandler(async (id) => this.detachAttachedFrameTargets(id))
    this.on('event', (event: CdpEvent) => this.handleJavaScriptDialogEvent(event))
  }
  handleTargetEvent(event: CdpEvent) {
    if (event.method === 'Target.attachedToTarget') {
      this.handleAttachedToTarget(event as FrameEvent)
      return
    }
    if (event.method === 'Target.detachedFromTarget') {
      this.handleDetachedFromTarget(event as FrameEvent)
      return
    }
    if (event.method === 'Page.frameNavigated') {
      const frame = event.params?.frame as {
        id: string
        parentId?: string
        url: string
        securityOrigin: string
      }
      if (
        typeof event.source.tabId === 'number' &&
        event.source.sessionId == null &&
        event.source.targetId == null &&
        frame.parentId == null
      ) {
        const id = event.source.tabId
        this.mainFrameIdsByTabId.set(id, frame.id)
        this.topLevelUrlsByTabId.set(id, frame.url)
        if (this.topLevelSecurityOriginsByTabId.get(id) !== frame.securityOrigin)
          this.discardRawCdpEventsForTab(id)
        this.topLevelSecurityOriginsByTabId.set(id, frame.securityOrigin)
      }
      this.handleFrameNavigated(event as FrameEvent)
      return
    }
    if (event.method === 'Page.navigatedWithinDocument') {
      if (
        typeof event.source.tabId === 'number' &&
        event.source.sessionId == null &&
        this.mainFrameIdsByTabId.get(event.source.tabId) === event.params?.frameId
      )
        this.topLevelUrlsByTabId.set(event.source.tabId, event.params!.url as string)
      return
    }
    if (event.method === 'Page.frameDetached') this.handleFrameDetached(event as FrameEvent)
  }
  async callRawCdp(
    input: number | string,
    method: string,
    params?: Record<string, unknown>,
    options: CdpOptions & { target?: { sessionId?: string; targetId?: string } } = {}
  ) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('callRawCdp requires numeric tab_id')
    const { target, ...rest } = options,
      selected = this.rawCdpTarget(id, target),
      run = () =>
        this.executeTargetCdp(selected, method, params, {
          ...rest,
          preserveDebuggerOnTimeout: true,
          telemetryAttrs: {
            ...rest.telemetryAttrs,
            'browser_use.cdp.domain': 'full',
            'browser_use.cdp.method': 'full'
          }
        })
    if (
      selected.sessionId == null &&
      selected.targetId == null &&
      ['Page.startScreencast', 'Page.stopScreencast'].includes(method)
    )
      return await this.withScreencastLock(id, async () => {
        const result = await run()
        if (method === 'Page.startScreencast') this.rawScreencastTabIds.add(id)
        else this.rawScreencastTabIds.delete(id)
        return result
      })
    return await run()
  }
  async browserAuthNewTargetCheck(id: number) {
    try {
      return (await this.api.browserAuthNewTargetProtection({ tabId: id, action: 'check' })) ===
        true
        ? 'contained'
        : 'rejected'
    } catch {
      return 'error'
    }
  }
  async protectBrowserAuthNewTargets(id: number) {
    const leaseId = crypto.randomUUID()
    if (
      (await this.api.browserAuthNewTargetProtection({ tabId: id, action: 'acquire', leaseId })) !==
      true
    )
      throw Error('Browser cannot protect newly opened credential targets')
    return async () => {
      if (
        (await this.api.browserAuthNewTargetProtection({
          tabId: id,
          action: 'release',
          leaseId
        })) !== true
      )
        throw Error('Browser could not release credential target protection')
    }
  }
  async closeBrowserAuthPausedTarget(id: number, targetId: string) {
    return (
      (await this.api.browserAuthNewTargetProtection({ tabId: id, action: 'close', targetId })) ===
      true
    )
  }
  async protectServiceWorkerStarts(id: number) {
    await this.ensureAttachedTab(id)
    this.workerStartProtectionByTab.set(id, (this.workerStartProtectionByTab.get(id) ?? 0) + 1)
    const release = async () => {
      const count = this.workerStartProtectionByTab.get(id) ?? 0
      if (count <= 1) this.workerStartProtectionByTab.delete(id)
      else this.workerStartProtectionByTab.set(id, count - 1)
      await this.configureServiceWorkerStarts(id)
    }
    try {
      await this.configureServiceWorkerStarts(id)
    } catch (error) {
      await release()
      throw error
    }
    let active = true
    return async () => {
      if (active) {
        active = false
        await release()
      } else await this.configureServiceWorkerStarts(id)
    }
  }
  configureServiceWorkerStarts(id: number) {
    const pending = (this.workerStartConfigurationByTab.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.isTabAttached(id)) return
        const protect = this.workerStartProtectionByTab.has(id)
        if (this.configuredWorkerStartProtection.has(id) !== protect) {
          if (protect) {
            await this.call(
              id,
              'Target.setAutoAttach',
              {
                autoAttach: true,
                flatten: true,
                waitForDebuggerOnStart: true,
                filter: [
                  { type: 'iframe', exclude: false },
                  { type: 'service_worker', exclude: false }
                ]
              },
              { preserveDebuggerOnTimeout: true }
            )
            this.configuredWorkerStartProtection.add(id)
          } else {
            await this.enableOopifAutoAttachForTarget(
              { tabId: id },
              { preserveDebuggerOnTimeout: true }
            )
            this.configuredWorkerStartProtection.delete(id)
          }
        }
      })
    this.workerStartConfigurationByTab.set(id, pending)
    void pending
      .finally(() => {
        if (this.workerStartConfigurationByTab.get(id) === pending)
          this.workerStartConfigurationByTab.delete(id)
      })
      .catch(() => {})
    return pending
  }
  async protectBrowserAuthServiceWorkerBypass(id: number) {
    await this.ensureAttachedTab(id)
    const state = this.browserAuthWorkerBypassByTab.get(id) ?? {
      count: 0,
      enabled: false,
      pending: Promise.resolve()
    }
    this.browserAuthWorkerBypassByTab.set(id, state)
    const update = () => {
      const request = state.pending
        .catch(() => {})
        .then(async () => {
          if (this.browserAuthWorkerBypassByTab.get(id) !== state) return
          const enabled = state.count > 0
          if (state.enabled !== enabled) {
            await this.call(
              id,
              'Network.setBypassServiceWorker',
              { bypass: enabled },
              { preserveDebuggerOnTimeout: true }
            )
            state.enabled = enabled
          }
          if (state.count === 0 && !state.enabled) this.browserAuthWorkerBypassByTab.delete(id)
        })
      state.pending = request
      return request
    }
    state.count++
    try {
      await update()
    } catch (error) {
      state.count--
      await update().catch(() => {})
      throw error
    }
    let active = true
    return async () => {
      if (active) {
        active = false
        state.count--
      }
      await update()
    }
  }
  async evaluateJavascript(
    id: number | string,
    source: string,
    options: {
      returnByValue?: boolean
      awaitPromise?: boolean
      telemetryAttrs?: Record<string, unknown>
      timeoutMs?: number
    } = {}
  ) {
    const params: Record<string, unknown> = {
      expression: source,
      returnByValue: options.returnByValue ?? true
    }
    if (options.awaitPromise != null) params.awaitPromise = options.awaitPromise
    const response = (await this.call(id, 'Runtime.evaluate', params, {
      telemetryAttrs: options.telemetryAttrs as Record<string, unknown>,
      timeoutMs: options.timeoutMs
    })) as {
      exceptionDetails?: { exception?: { value?: unknown; description?: string }; text?: string }
      result?: { value?: unknown }
    }
    if (response.exceptionDetails != null) {
      const details = response.exceptionDetails
      throw Error(
        `Browser Use encountered an error interacting with this webpage: ${(typeof details.exception?.value === 'string' ? details.exception.value : details.exception?.description) ?? details.text ?? 'JavaScript evaluation failed'}`
      )
    }
    return response.result?.value
  }
  async readDocumentState(input: number | string, options: { includePaint?: boolean } = {}) {
    try {
      const state = (await this.evaluateJavascript(
        input,
        options.includePaint === true
          ? "({ href: window.location.href, readyState: document.readyState, painted: performance.getEntriesByType('paint').some(entry => entry.name === 'first-paint' || entry.name === 'first-contentful-paint') })"
          : '({ href: window.location.href, readyState: document.readyState })',
        { telemetryAttrs: { 'browser_use.cdp.eval.kind': 'document_state' } }
      )) as { href?: string; readyState?: string; painted?: boolean } | undefined
      const id = Number(input)
      if (Number.isFinite(id) && typeof state?.href === 'string' && state.href.length > 0)
        this.topLevelUrlsByTabId.set(id, state.href)
      return state
    } catch {
      return undefined
    }
  }
  async waitForEvent(
    input: number | string,
    predicate: (event: CdpEvent) => boolean,
    options: {
      signal?: AbortSignal
      timeoutMs: number
      timeoutMessage: string
      initialCheck?: () => Promise<boolean>
      action?: () => Promise<unknown>
    }
  ): Promise<CdpEvent | undefined> {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('waitForEvent requires numeric tab_id')
    if (options.signal?.aborted) throw Error('waitForEvent aborted')
    let resolve!: (event: CdpEvent | undefined) => void,
      reject!: (error: unknown) => void,
      completed = false
    const result = new Promise<CdpEvent | undefined>((yes, no) => {
        resolve = yes
        reject = no
      }),
      success = (event?: CdpEvent) => {
        if (!completed) {
          completed = true
          resolve(event)
        }
      },
      failure = (error: unknown) => {
        if (!completed) {
          completed = true
          reject(error)
        }
      },
      abort = () => failure(Error('waitForEvent aborted')),
      event = (event: CdpEvent) => {
        if (completed || event.source.tabId !== id) return
        try {
          if (predicate(event)) success(event)
        } catch (error) {
          failure(
            error instanceof Error
              ? error
              : Error(`waitForEvent predicate failed: ${String(error)}`)
          )
        }
      },
      timer = setTimeout(() => failure(Error(options.timeoutMessage)), options.timeoutMs)
    void result.catch(() => {})
    try {
      options.signal?.addEventListener('abort', abort, { once: true })
      this.addListener('event', event)
      if (options.initialCheck !== undefined)
        void options.initialCheck().then((ready) => {
          if (ready) success()
        }, failure)
      if (!options.signal?.aborted) await options.action?.()
      return await result
    } finally {
      this.removeListener('event', event)
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }
  async waitForPageLoadEvent(
    input: number | string | CdpTarget,
    options: {
      classificationTimeoutMs?: number
      timeoutMs: number
      rejectSubframeNavigationBlocked?: boolean
    }
  ) {
    let target: CdpTarget
    if (typeof input === 'object') target = input
    else {
      const id = Number(input)
      if (!Number.isFinite(id)) throw Error('waitForPageLoadEvent requires numeric tab_id')
      target = { tabId: id }
    }
    const outcome = await new Promise<CdpEvent | undefined>((resolve) => {
      let loading = false
      const frames = new Set<string>(),
        finish = (event?: CdpEvent) => {
          this.removeListener('event', listener)
          clearTimeout(timer)
          resolve(event)
        },
        matches = (event: CdpEvent) =>
          target.sessionId != null
            ? event.source.sessionId === target.sessionId
            : target.targetId != null
              ? event.source.targetId === target.targetId
              : event.source.sessionId == null && event.source.targetId == null,
        listener = (event: CdpEvent) => {
          if (event.source.tabId !== target.tabId || !matches(event)) return
          const params = event.params ?? {},
            frame = params.frame as { id: string; parentId?: string } | undefined,
            nested = target.sessionId != null || target.targetId != null
          if (
            event.method === 'Page.navigationBlocked' &&
            (params.resourceType !== 'subFrame' || options.rejectSubframeNavigationBlocked === true)
          ) {
            finish(event)
            return
          }
          switch (event.method) {
            case 'Page.navigatedWithinDocument':
              if (
                (nested || this.mainFrameIdsByTabId.get(event.source.tabId) === params.frameId) &&
                !frames.has(params.frameId as string)
              )
                finish(event)
              return
            case 'Page.frameStartedLoading':
            case 'Page.frameNavigated':
              if (event.method === 'Page.frameNavigated') {
                if (params.type === 'BackForwardCacheRestore') {
                  if (
                    nested ||
                    (event.source.sessionId == null &&
                      event.source.targetId == null &&
                      frame?.parentId == null)
                  )
                    finish(event)
                  return
                }
                frames.add(frame!.id)
              }
              if (loading) return
              loading = true
              clearTimeout(timer)
              timer = setTimeout(() => finish(), options.timeoutMs)
              return
            case 'Page.domContentEventFired':
            case 'Page.loadEventFired':
              if (loading) finish(event)
              return
          }
        },
        timerInitial = options.classificationTimeoutMs ?? 250
      let timer = setTimeout(() => finish(), timerInitial)
      this.addListener('event', listener)
    })
    if (outcome?.method === 'Page.navigationBlocked') {
      let display = 'this page'
      try {
        const value = outcome.params?.url
        if (typeof value === 'string') {
          const url = new URL(value)
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
  }
  deleteFileChoosersForTab(id: number) {
    for (const [key, value] of this.fileChoosersById)
      if (value.tabId === id) this.fileChoosersById.delete(key)
  }
  async closeTab(input: number | string) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('closeTab requires numeric tab_id')
    const response = (await this.call(input, 'Target.getTargets', {})) as {
        targetInfos: { tabId?: number; targetId?: string; id?: string }[]
      },
      target = response.targetInfos.find((target) => 'tabId' in target && target.tabId === id)
    await this.ensureAttachedTab(id)
    try {
      await this.runTabCleanupHandlers(id)
      const targetId =
        typeof target?.targetId === 'string'
          ? target.targetId
          : typeof target?.id === 'string'
            ? target.id
            : undefined
      await this.api.executeCdp({
        target: { tabId: id },
        method: targetId != null ? 'Target.closeTarget' : 'Page.close',
        commandParams: targetId != null ? { targetId } : {}
      })
    } finally {
      this.forgetAttachedTab(id)
    }
  }
  protected override clearTabState(id: number) {
    super.clearTabState(id)
    this.deleteFileChoosersForTab(id)
    this.workerStartProtectionByTab.delete(id)
    this.browserAuthWorkerBypassByTab.delete(id)
    this.configuredWorkerStartProtection.delete(id)
    this.workerStartConfigurationByTab.delete(id)
  }
}
