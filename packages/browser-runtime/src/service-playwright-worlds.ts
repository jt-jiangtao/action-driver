import type { CdpTarget } from './service-cdp-execution.js'
import type { CdpEvent } from './service-cdp-events.js'
import type { CdpOptions } from './service-cdp-attachment.js'
import { playwrightInjectedSource, protectedField } from './service-playwright-injected.js'
import {
  assertSelectorDeadline,
  selectorBudget,
  selectorResult,
  isMissingInjectedError,
  isDestroyedSelectorContext,
  selectorTargetKey,
  selectorTargetKeys,
  selectorKeyMatches,
  selectorTelemetry,
  selectorOperation
} from './service-selector-policy.js'
export interface PlaywrightCdp {
  addListener(event: string, listener: (value: any) => void): unknown
  call(
    id: number | string,
    method: string,
    params: Record<string, unknown> | undefined,
    options?: CdpOptions
  ): Promise<any>
  callTarget?(
    target: CdpTarget,
    method: string,
    params: Record<string, unknown> | undefined,
    options?: CdpOptions
  ): Promise<any>
}
export interface SelectorExecutionTarget {
  frameId?: string | undefined
  target: CdpTarget
  oopifFrameChain: unknown[]
}
interface RuntimeResult {
  result?: { value?: unknown; objectId?: string }
  exceptionDetails?: {
    text?: string
    exception?: { value?: unknown; description?: string; objectId?: string }
  }
  executionContextId?: number | undefined
}
const injectedConstant = '__codexPlaywrightInjected',
  missing = 'Browser Use Playwright injected helper is missing'
export function playwrightInstallExpression() {
  return `(() => { const __name = (target) => target; if (!window.${injectedConstant}) { ${playwrightInjectedSource()} window.${injectedConstant} = new PlaywrightInjected.InjectedScript(window, {isUnderTest:false,sdkLanguage:"javascript",testIdAttributeName:"data-testid",stableRafCount:1,browserName:"chromium",customEngines:[]}); } window.${injectedConstant}.isProtectedCredentialField = (${protectedField.toString()}); })()`
}
/** Helper installation and CDP execution worlds, shared by the concrete selector backend. */
export class PlaywrightWorlds {
  static injectedConstant = injectedConstant
  playwrightFrameWorlds = new Map<string, { executionContextId: number }>()
  playwrightInjectedTargets = new Set<string>()
  constructor(public cdp: PlaywrightCdp) {
    cdp.addListener('tabDetached', (id: number) => {
      for (const key of this.playwrightInjectedTargets)
        if (key === String(id) || key.startsWith(`${id}:`))
          this.playwrightInjectedTargets.delete(key)
      for (const key of this.playwrightFrameWorlds.keys())
        if (key === String(id) || key.startsWith(`${id}:`)) this.playwrightFrameWorlds.delete(key)
    })
    cdp.addListener('event', (event: CdpEvent) => {
      if (
        event.method === 'Runtime.executionContextsCleared' ||
        (event.method === 'Page.frameNavigated' &&
          (event.params?.frame as { parentId?: string })?.parentId == null)
      )
        this.clearPlaywrightStateForTarget(event.source)
      else if (event.method === 'Page.frameNavigated')
        this.deletePlaywrightFrameWorld(event.source, (event.params!.frame as { id: string }).id)
      else if (event.method === 'Page.frameDetached')
        this.deletePlaywrightFrameWorld(event.source, event.params!.frameId as string)
      else if (event.method === 'Target.attachedToTarget')
        this.clearPlaywrightFrameWorldsForTarget(event.source)
    })
  }
  async callCdpTarget(
    target: CdpTarget,
    method: string,
    params: Record<string, unknown> | undefined,
    options: CdpOptions = {}
  ) {
    return typeof this.cdp.callTarget === 'function'
      ? await this.cdp.callTarget(target, method, params, options)
      : await this.cdp.call(target.tabId, method, params, options)
  }
  async playwrightFrameWorld(target: CdpTarget, frameId: string, options: CdpOptions = {}) {
    const key = selectorTargetKey(target, frameId),
      cached = this.playwrightFrameWorlds.get(key)
    if (cached != null) return cached
    assertSelectorDeadline(options)
    const result = {
      executionContextId: (
        await this.callCdpTarget(
          target,
          'Page.createIsolatedWorld',
          { frameId, grantUniveralAccess: false, worldName: 'browser-use-playwright' },
          options
        )
      ).executionContextId as number
    }
    this.playwrightFrameWorlds.set(key, result)
    if (this.playwrightFrameWorlds.size > 50) {
      const first = this.playwrightFrameWorlds.keys().next().value
      if (first != null) {
        this.playwrightFrameWorlds.delete(first)
        this.playwrightInjectedTargets.delete(first)
      }
    }
    return result
  }
  deletePlaywrightFrameWorld(target: CdpTarget, frameId: string) {
    const key = selectorTargetKey(target, frameId)
    this.playwrightFrameWorlds.delete(key)
    this.playwrightInjectedTargets.delete(key)
  }
  clearPlaywrightFrameWorldsForTarget(target: CdpTarget) {
    const prefixes = selectorTargetKeys(target)
    for (const key of this.playwrightFrameWorlds.keys())
      if (prefixes.some((prefix) => selectorKeyMatches(key, prefix))) {
        this.playwrightFrameWorlds.delete(key)
        this.playwrightInjectedTargets.delete(key)
      }
  }
  clearPlaywrightStateForTarget(target: CdpTarget) {
    const prefixes = selectorTargetKeys(target)
    for (const key of this.playwrightInjectedTargets)
      if (prefixes.some((prefix) => selectorKeyMatches(key, prefix)))
        this.playwrightInjectedTargets.delete(key)
    for (const key of this.playwrightFrameWorlds.keys())
      if (prefixes.some((prefix) => selectorKeyMatches(key, prefix)))
        this.playwrightFrameWorlds.delete(key)
  }
  async callRuntimeEvaluateInExecutionTarget(
    target: SelectorExecutionTarget,
    params: Record<string, unknown>,
    options: CdpOptions = {},
    cacheKey?: string
  ) {
    assertSelectorDeadline(options)
    const context =
      target.frameId == null
        ? undefined
        : (await this.playwrightFrameWorld(target.target, target.frameId, options))
            .executionContextId
    assertSelectorDeadline(options)
    return {
      ...(await this.callCdpTarget(
        target.target,
        'Runtime.evaluate',
        { ...params, ...(context == null ? {} : { contextId: context }) },
        { ...options, expressionCacheKey: cacheKey }
      )),
      executionContextId: context
    } as RuntimeResult
  }
  async ensurePlaywrightInjected(input: number | string, options: CdpOptions = {}) {
    const id = Number(input)
    if (!Number.isFinite(id)) throw Error('ensurePlaywrightInjected requires numeric tab_id')
    await this.ensurePlaywrightInjectedInTarget({ tabId: id }, options)
  }
  async ensurePlaywrightInjectedInTarget(
    target: CdpTarget,
    options: CdpOptions = {},
    frameId?: string
  ) {
    const key = selectorTargetKey(target, frameId),
      operation = selectorOperation(options.telemetryAttrs) ?? 'unknown'
    if (this.playwrightInjectedTargets.has(key)) return
    assertSelectorDeadline(options)
    selectorResult(
      await this.callRuntimeEvaluateInExecutionTarget(
        { frameId, target, oopifFrameChain: [] },
        { awaitPromise: true, expression: playwrightInstallExpression(), returnByValue: true },
        {
          timeoutMs: options.timeoutMs,
          ...(options.deadlineMs == null ? {} : { deadlineMs: options.deadlineMs }),
          telemetryAttrs: selectorTelemetry({ operation, phase: 'inject_install' })
        },
        'playwright-injected'
      )
    )
    this.playwrightInjectedTargets.add(key)
  }
  async releaseRuntimeObjects(target: CdpTarget, ids: (string | undefined)[], options: CdpOptions) {
    const cleanup = {
      deadlineMs: Date.now() + 100,
      telemetryAttrs: options.telemetryAttrs,
      timeoutMs: 100
    }
    for (const id of new Set(ids))
      if (id != null)
        await this.callCdpTarget(target, 'Runtime.releaseObject', { objectId: id }, cleanup).catch(
          () => {}
        )
  }
  async callRuntimeEvaluateWithPlaywrightInjectedInTarget(
    target: CdpTarget,
    params: Record<string, unknown> & { expression: string },
    options: CdpOptions = {},
    frameId?: string
  ) {
    assertSelectorDeadline(options)
    await this.ensurePlaywrightInjectedInTarget(target, options, frameId)
    const evaluate = async () => {
      const budget = selectorBudget(options),
        request: Record<string, unknown> = {
          ...params,
          expression: `(() => { if (!window.${injectedConstant}) { throw new Error(${JSON.stringify(missing)}); } return (${params.expression}); })()`
        }
      delete request.timeout
      if (budget.timeoutMs != null && budget.timeoutMs > 0) request.timeout = budget.timeoutMs
      return {
        options: budget,
        result: await this.callRuntimeEvaluateInExecutionTarget(
          { frameId, target, oopifFrameChain: [] },
          request,
          budget
        )
      }
    }
    const invalidate = (error: unknown) => {
      if (isMissingInjectedError(error)) {
        if (frameId == null) this.clearPlaywrightStateForTarget(target)
        else this.deletePlaywrightFrameWorld(target, frameId)
        return true
      }
      if (frameId != null && isDestroyedSelectorContext(error)) {
        this.deletePlaywrightFrameWorld(target, frameId)
        return true
      }
      return false
    }
    try {
      const response = await evaluate()
      let error: unknown
      try {
        selectorResult(response.result)
      } catch (value) {
        error = value
      }
      if (error == null || !invalidate(error)) return response.result
      await this.releaseRuntimeObjects(
        target,
        [response.result.result?.objectId, response.result.exceptionDetails?.exception?.objectId],
        response.options
      )
    } catch (error) {
      if (!invalidate(error)) throw error
    }
    assertSelectorDeadline(options)
    await this.ensurePlaywrightInjectedInTarget(target, options, frameId)
    assertSelectorDeadline(options)
    return (await evaluate()).result
  }
  async evaluateWithPlaywrightInjectedInTarget(
    target: CdpTarget,
    expression: string,
    options: CdpOptions = {},
    frameId?: string
  ) {
    return selectorResult(
      await this.callRuntimeEvaluateWithPlaywrightInjectedInTarget(
        target,
        { expression, returnByValue: true, awaitPromise: true },
        options,
        frameId
      )
    )
  }
  async evaluateWithPlaywrightInjected(
    input: number | string,
    expression: string,
    options: CdpOptions
  ) {
    return await this.evaluateWithPlaywrightInjectedInTarget(
      { tabId: Number(input) },
      expression,
      options
    )
  }
}
