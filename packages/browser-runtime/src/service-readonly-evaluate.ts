import { playwrightInstallExpression } from './service-playwright-worlds.js'
import {
  assertReadonlyScript,
  readonlyExpression,
  readonlyResult
} from './service-readonly-sandbox.js'
import type { CdpTarget } from './service-cdp-execution.js'
interface Cdp {
  call(
    id: number,
    method: string,
    params: Record<string, unknown> | undefined,
    options: Record<string, unknown>
  ): Promise<any>
  callTarget(
    target: CdpTarget,
    method: string,
    params: Record<string, unknown> | undefined,
    options: Record<string, unknown>
  ): Promise<any>
}
interface Context {
  cdp: Cdp
  playwright?: {
    resolvePlaywrightSelectorNode(
      id: number,
      selector: string,
      options: Record<string, unknown>
    ): Promise<{ backendNodeId: number; frameId?: string; target: CdpTarget }>
    prepareReadonlyLocatorAll(
      id: number,
      selector: string,
      script: string,
      options: Record<string, unknown>
    ): Promise<{ target: CdpTarget; frameId?: string; expression: string }>
  }
  commandTiming?: {
    startLocatorRetry(): { attemptFailed(): void; finish(outcome: 'success' | 'timeout'): void }
  }
}
interface Params {
  tab_id: number
  script: string
  selector?: string
  selector_mode?: 'all'
  timeout_ms?: number
}
interface EvaluationTarget {
  target: CdpTarget
  frameId: string
  backendNodeId?: number
}
let elementSequence = 0
const cachedWorlds = new Map<string, { executionContextId: number; frameId: string }>()
const timeout = (value: number | undefined) =>
  Math.min(Math.max(0, typeof value === 'number' ? value : 3000), 3000)
const key = (target: CdpTarget, frame: string) => {
  const route = target.sessionId ?? target.targetId
  return route == null ? `${target.tabId}:${frame}` : `${target.tabId}:${route}:${frame}`
}
const options = (kind: string, deadlineMs: number, timeoutMs: number) => ({
  deadlineMs,
  timeoutMs,
  telemetryAttrs: { 'browser_use.cdp.eval.kind': kind }
})
const cleanupOptions = () => options('readonly_live_dom_cleanup', Date.now() + 100, 100)
function positive(value: unknown) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return id
}
async function call(
  context: Context,
  target: CdpTarget,
  method: string,
  params: Record<string, unknown> | undefined,
  opts: Record<string, unknown>
) {
  return target.sessionId != null || target.targetId != null
    ? await context.cdp.callTarget(target, method, params, opts)
    : await context.cdp.call(target.tabId, method, params, opts)
}
async function release(context: Context, target: CdpTarget, ids: (string | undefined)[]) {
  for (const objectId of new Set(ids))
    if (objectId != null)
      await call(context, target, 'Runtime.releaseObject', { objectId }, cleanupOptions()).catch(
        () => {}
      )
}
async function frame(context: Context, target: CdpTarget, deadlineMs: number, timeoutMs: number) {
  const response = await call(
      context,
      target,
      'Page.getFrameTree',
      undefined,
      options('readonly_js_frame_tree', deadlineMs, timeoutMs)
    ),
    id = response.frameTree.frame.id
  if (!id) throw Error('playwright.evaluate could not find a frame')
  return id as string
}
async function world(
  context: Context,
  target: EvaluationTarget,
  deadlineMs: number,
  timeoutMs: number
) {
  const id = key(target.target, target.frameId),
    cached = cachedWorlds.get(id)
  if (cached != null) return cached
  const result = await call(
      context,
      target.target,
      'Page.createIsolatedWorld',
      { frameId: target.frameId, grantUniveralAccess: false, worldName: 'browser-use-readonly-js' },
      options('readonly_js_world', deadlineMs, timeoutMs)
    ),
    value = { executionContextId: result.executionContextId as number, frameId: target.frameId }
  cachedWorlds.set(id, value)
  if (cachedWorlds.size > 20) cachedWorlds.delete(cachedWorlds.keys().next().value!)
  return value
}
function budget(deadlineMs: number, timeoutMs: number) {
  const remaining = deadlineMs - Date.now()
  if (remaining <= 0) throw Error('playwright.evaluate exceeded its deadline')
  return Math.max(1, Math.min(timeoutMs, remaining))
}
async function run(
  context: Context,
  target: EvaluationTarget,
  contextId: number,
  script: string,
  deadlineMs: number,
  timeoutMs: number,
  expression?: string
) {
  const opts = options('readonly_live_dom', deadlineMs, timeoutMs)
  if (expression != null)
    await call(
      context,
      target.target,
      'Runtime.evaluate',
      {
        awaitPromise: true,
        expression: playwrightInstallExpression(),
        returnByValue: true,
        contextId,
        timeout: budget(deadlineMs, timeoutMs)
      },
      opts
    )
  let elementName: string | undefined, objectId: string | undefined
  if (target.backendNodeId != null) {
    const resolved = await call(
      context,
      target.target,
      'DOM.resolveNode',
      { backendNodeId: target.backendNodeId, executionContextId: contextId },
      opts
    )
    objectId = resolved.object.objectId
    if (objectId == null) throw Error('playwright.evaluate could not resolve the locator element')
    elementName = `__browserUseReadonlyElement${elementSequence++}`
    let bindingErrorId: string | undefined
    try {
      const bound = await call(
        context,
        target.target,
        'Runtime.callFunctionOn',
        {
          arguments: [{ value: elementName }],
          functionDeclaration: 'function (name) { globalThis[name] = this; }',
          objectId,
          returnByValue: true
        },
        opts
      )
      bindingErrorId = bound.exceptionDetails?.exception?.objectId
      readonlyResult(bound)
    } catch (error) {
      await call(
        context,
        target.target,
        'Runtime.evaluate',
        {
          contextId,
          expression: `delete globalThis[${JSON.stringify(elementName)}]`,
          returnByValue: true
        },
        cleanupOptions()
      ).catch(() => {})
      throw error
    } finally {
      await release(context, target.target, [objectId, bindingErrorId])
    }
  }
  const source =
    expression ??
    readonlyExpression(
      script,
      elementName == null ? undefined : `rawWindow[${JSON.stringify(elementName)}]`
    )
  try {
    return await call(
      context,
      target.target,
      'Runtime.evaluate',
      {
        awaitPromise: true,
        contextId,
        expression: source,
        returnByValue: true,
        timeout: budget(deadlineMs, timeoutMs)
      },
      opts
    )
  } finally {
    if (elementName != null)
      await call(
        context,
        target.target,
        'Runtime.evaluate',
        {
          contextId,
          expression: `delete globalThis[${JSON.stringify(elementName)}]`,
          returnByValue: true
        },
        cleanupOptions()
      ).catch(() => {})
  }
}
/** Run user JavaScript only in the read-only DOM facade and a document-bound isolated world. */
export async function evaluateReadonly(params: Params, context: Context) {
  const id = positive(params.tab_id),
    timeoutMs = timeout(params.timeout_ms),
    deadlineMs = Date.now() + timeoutMs
  assertReadonlyScript(params.script)
  let target: EvaluationTarget, preparedExpression: string | undefined
  if (params.selector_mode === 'all') {
    if (params.selector == null)
      throw Error('playwright.evaluate selector_mode=all requires a selector')
    if (context.playwright == null) throw Error('Playwright selector service is unavailable')
    const prepared = await context.playwright.prepareReadonlyLocatorAll(
      id,
      params.selector,
      readonlyExpression(
        params.script,
        undefined,
        'elements',
        'selectorScope?.root?.defaultView ?? globalThis'
      ),
      { deadlineMs, timeoutMs }
    )
    target = {
      target: prepared.target,
      frameId: prepared.frameId ?? (await frame(context, prepared.target, deadlineMs, timeoutMs))
    }
    preparedExpression = prepared.expression
  } else if (params.selector != null) {
    if (context.playwright == null || context.commandTiming == null)
      throw Error('Playwright selector service is unavailable')
    const retry = context.commandTiming.startLocatorRetry()
    for (;;) {
      let attempted: EvaluationTarget | undefined
      try {
        const node = await context.playwright.resolvePlaywrightSelectorNode(id, params.selector, {
          deadlineMs,
          retry: false,
          timeoutMs
        })
        attempted = {
          backendNodeId: node.backendNodeId,
          target: node.target,
          frameId: node.frameId ?? (await frame(context, node.target, deadlineMs, timeoutMs))
        }
        const created = await world(context, attempted, deadlineMs, timeoutMs),
          response = await run(
            context,
            attempted,
            created.executionContextId,
            params.script,
            deadlineMs,
            timeoutMs
          )
        retry.finish('success')
        try {
          return { value: readonlyResult(response) }
        } finally {
          await release(context, attempted.target, [
            response.result?.objectId,
            response.exceptionDetails?.exception?.objectId
          ])
        }
      } catch (error) {
        if (/strict mode violation:/.test(error instanceof Error ? error.message : String(error)))
          throw error
        if (
          attempted != null &&
          /Cannot find context|Execution context was destroyed|context.*destroyed|context.*not found/i.test(
            error instanceof Error ? error.message : String(error)
          )
        )
          cachedWorlds.delete(key(attempted.target, attempted.frameId))
        retry.attemptFailed()
        if (Date.now() >= deadlineMs) {
          retry.finish('timeout')
          throw Error(
            `Timed out after ${timeoutMs}ms evaluating selector ${params.selector}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, Math.min(100, deadlineMs - Date.now())))
        )
      }
    }
  } else
    target = {
      target: { tabId: id },
      frameId: await frame(context, { tabId: id }, deadlineMs, timeoutMs)
    }
  let created = await world(context, target, deadlineMs, timeoutMs),
    response
  try {
    response = await run(
      context,
      target,
      created.executionContextId,
      params.script,
      deadlineMs,
      timeoutMs,
      preparedExpression
    )
  } catch (error) {
    if (
      !/Cannot find context|Execution context was destroyed|context.*destroyed|context.*not found/i.test(
        error instanceof Error ? error.message : String(error)
      )
    )
      throw error
    cachedWorlds.delete(key(target.target, target.frameId))
    created = await world(context, target, deadlineMs, timeoutMs)
    response = await run(
      context,
      target,
      created.executionContextId,
      params.script,
      deadlineMs,
      timeoutMs,
      preparedExpression
    )
  }
  try {
    return { value: readonlyResult(response) }
  } finally {
    await release(context, target.target, [
      response.result?.objectId,
      response.exceptionDetails?.exception?.objectId
    ])
  }
}
