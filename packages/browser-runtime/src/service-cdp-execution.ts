import {
  CdpAttachmentLifecycle,
  assertCdpDeadline,
  cdpTimeout,
  cdpDeadlineMessage
} from './service-cdp-attachment.js'
import type { CdpOptions, CdpAttachmentApi } from './service-cdp-attachment.js'
export interface CdpTarget {
  tabId: number
  sessionId?: string
  targetId?: string
}
export interface CdpDispatch {
  target: CdpTarget
  method: string
  commandParams: Record<string, unknown>
  timeoutMs?: number | undefined
  preserveDebuggerOnTimeout?: true
}
export interface CdpExecutionApi extends CdpAttachmentApi {
  executeCdp(params: CdpDispatch): Promise<unknown>
  executeCdpWithCachedExpression(params: CdpDispatch, key: string): Promise<unknown>
}
export interface CdpPerformanceSpan {
  currentCommandAttrs(): Record<string, unknown>
  withSpan<T>(name: string, attrs: Record<string, unknown>, run: () => Promise<T>): Promise<T>
}
export async function withinCdpDeadline<T>(promise: Promise<T>, options: CdpOptions): Promise<T> {
  if (options.deadlineMs == null) return await promise
  const remaining = options.deadlineMs - Date.now()
  if (remaining <= 0) {
    void promise.catch(() => {})
    throw Error(cdpDeadlineMessage)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(cdpDeadlineMessage)), remaining)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
const nested = (target: CdpTarget) => target.sessionId != null || target.targetId != null
const expression = (params: unknown): params is Record<string, unknown> & { expression: string } =>
  typeof params === 'object' &&
  params !== null &&
  'expression' in params &&
  typeof params.expression === 'string'
export class CdpExecutor extends CdpAttachmentLifecycle {
  captureException:
    | ((error: Error, options: { tags: Record<string, string> }) => unknown)
    | undefined
  constructor(
    protected override api: CdpExecutionApi,
    protected performanceSpan: CdpPerformanceSpan
  ) {
    super(api)
  }
  async call(
    input: number | string,
    method: string,
    params?: Record<string, unknown>,
    options: CdpOptions = {}
  ) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('callCdp requires numeric tab_id')
    return await this.callTarget({ tabId: id }, method, params, options)
  }
  async callTarget(
    target: CdpTarget,
    method: string,
    params?: Record<string, unknown>,
    options: CdpOptions = {}
  ) {
    return await this.executeTargetCdp(target, method, params, options)
  }
  /** Concrete manager supplies dialog state before enabling page/frame operations. */
  protected assertMethodAllowed(_id: number, _method: string): void {}
  async executeTargetCdp(
    target: CdpTarget,
    method: string,
    params?: Record<string, unknown>,
    options: CdpOptions = {},
    retry = true
  ): Promise<unknown> {
    this.assertMethodAllowed(target.tabId, method)
    assertCdpDeadline(options)
    const canRetry = retry && !nested(target) && !this.initializingTabIds.has(target.tabId)
    try {
      await withinCdpDeadline(
        this.ensureAttachedTab(target.tabId, { timeoutMs: cdpTimeout(options) }),
        options
      )
    } catch (error) {
      if (error === 'Debugger unattached' && canRetry)
        return await this.executeTargetCdp(target, method, params, options, false)
      throw error
    }
    if (options.prepareDispatch !== undefined) {
      assertCdpDeadline(options)
      await withinCdpDeadline(options.prepareDispatch(), options)
    }
    return await this.performanceSpan.withSpan(
      'browser_use.cdp.execute',
      {
        'browser_use.cdp.domain': method.split('.', 1)[0] ?? method,
        'browser_use.cdp.method': method,
        'browser_use.tab.id': target.tabId,
        'tab.id': target.tabId,
        ...this.performanceSpan.currentCommandAttrs(),
        ...(method === 'Runtime.evaluate' && expression(params)
          ? {
              'browser_use.cdp.eval.await_promise': params.awaitPromise,
              'browser_use.cdp.eval.return_by_value': params.returnByValue
            }
          : {}),
        ...options.telemetryAttrs
      },
      async () => {
        const attached = this.attachedTabIds.has(target.tabId)
          ? this.tabAttachmentPromises.get(target.tabId)
          : undefined
        options.beforeDispatch?.()
        const timeoutMs = cdpTimeout(options)
        try {
          const request: CdpDispatch = {
            target,
            method,
            commandParams: params ?? {},
            ...(options.preserveDebuggerOnTimeout === true
              ? { preserveDebuggerOnTimeout: true }
              : {}),
            timeoutMs
          }
          if (options.expressionCacheKey == null) return await this.api.executeCdp(request)
          if (!expression(params)) throw Error('Cached CDP execution requires an expression')
          return await this.api.executeCdpWithCachedExpression(
            { ...request, commandParams: params },
            options.expressionCacheKey
          )
        } catch (error) {
          if (
            error === 'Debugger unattached' ||
            (typeof error === 'string' && error.includes('Debugger is not attached'))
          ) {
            if (attached !== undefined && this.tabAttachmentPromises.get(target.tabId) === attached)
              this.forgetAttachedTab(target.tabId)
            if (canRetry) return this.executeTargetCdp(target, method, params, options, false)
          }
          const message = error instanceof Error ? error.message : error
          if (
            typeof message === 'string' &&
            (message.startsWith('Timed out running CDP command "') ||
              message.startsWith('Timed out translating CDP input command "') ||
              (message.startsWith('Timed out after ') &&
                message.includes('ms waiting for CDP command ')))
          ) {
            const reported = new Error('Browser Use CDP command timed out')
            reported.name = 'CdpCommandTimeoutError'
            const full = options.telemetryAttrs?.['browser_use.cdp.method'] === 'full'
            this.captureException?.(reported, {
              tags: {
                'browser_use.cdp.domain': full ? 'full' : (method.split('.', 1)[0] ?? method),
                'browser_use.cdp.method': full ? 'full' : method,
                'browser_use.cdp.target_type': nested(target) ? 'nested' : 'tab'
              }
            })
          }
          throw error
        }
      }
    )
  }
}
