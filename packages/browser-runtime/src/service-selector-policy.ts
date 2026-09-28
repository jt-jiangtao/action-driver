import type { CdpTarget } from './service-cdp-execution.js'
interface Options {
  deadlineMs?: number | undefined
  timeoutMs?: number | undefined
  startedAt?: number
  retry?: boolean | undefined
}
interface RetryOptions extends Options {
  startedAt: number
  timeoutMs: number
}
interface Timing {
  startLocatorRetry(): { attemptFailed(): void; finish(outcome: 'success' | 'timeout'): void }
}
export const selectorDeadlineError = 'Playwright selector deadline exceeded'
export function assertSelectorDeadline(options: Options) {
  if (options.deadlineMs != null && Date.now() >= options.deadlineMs)
    throw Error(selectorDeadlineError)
}
export function withSelectorDeadline<T extends Options>(
  options: T,
  startedAt: number,
  timeoutMs: number
): T {
  const deadlineMs = startedAt + timeoutMs
  return timeoutMs <= 0 || (options.deadlineMs != null && options.deadlineMs <= deadlineMs)
    ? options
    : { ...options, deadlineMs }
}
export function selectorBudget<T extends Options>(options: T) {
  assertSelectorDeadline(options)
  if (options.deadlineMs == null) return options
  const left = options.deadlineMs - Date.now()
  return { ...options, timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? left, left)) }
}
export function selectorRetryDelay(options: Options) {
  return options.deadlineMs == null
    ? 100
    : Math.max(1, Math.min(100, options.deadlineMs - Date.now()))
}
export function isStrictSelectorError(error: unknown) {
  return String(error instanceof Error ? error.message : error).includes('strict mode violation:')
}
export function isMissingInjectedError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error)
  return (
    message.includes('Browser Use Playwright injected helper is missing') ||
    /Cannot read properties of (?:undefined|null) \(reading ['"]incrementalAriaSnapshot['"]\)/.test(
      message
    )
  )
}
export function isDestroyedSelectorContext(error: unknown) {
  return /Cannot find context|Execution context was destroyed|context.*destroyed|context.*not found/i.test(
    error instanceof Error ? error.message : String(error)
  )
}
export function selectorResult(response: {
  result?: { value?: unknown }
  exceptionDetails?: { exception?: { value?: unknown; description?: string }; text?: string }
}) {
  if (response.exceptionDetails != null) {
    const details = response.exceptionDetails,
      value = details.exception?.value,
      description =
        details.exception?.description ??
        details.text ??
        (value == null ? 'Playwright selector evaluation failed.' : String(value))
    throw Error(`Browser Use encountered an error interacting with this webpage: ${description}`)
  }
  return response.result?.value
}
export async function retrySelector<T>(
  selector: string,
  run: () => Promise<T>,
  options: RetryOptions,
  timing: Timing
) {
  const retry = options.retry !== false ? timing.startLocatorRetry() : undefined
  try {
    for (;;) {
      assertSelectorDeadline(options)
      try {
        const result = await run()
        retry?.finish('success')
        return result
      } catch (error) {
        if (isStrictSelectorError(error) || options.retry === false) throw error
        retry?.attemptFailed()
        if (Date.now() - options.startedAt >= options.timeoutMs) {
          retry?.finish('timeout')
          throw Error(
            `Timed out after ${options.timeoutMs}ms waiting for selector ${selector}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        }
        assertSelectorDeadline(options)
        await new Promise((resolve) => setTimeout(resolve, selectorRetryDelay(options)))
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === selectorDeadlineError &&
      options.timeoutMs > 0 &&
      options.deadlineMs === options.startedAt + options.timeoutMs
    )
      retry?.finish('timeout')
    throw error
  }
}
export function selectorTargetKey(target: CdpTarget, frameId?: string) {
  const frame = frameId == null ? '' : ':' + frameId
  return target.sessionId != null
    ? `${target.tabId}:${target.sessionId}${frame}`
    : target.targetId != null
      ? `${target.tabId}:${target.targetId}${frame}`
      : `${target.tabId}${frame}`
}
export function selectorTargetKeys(target: CdpTarget) {
  const result = [
    ...(target.sessionId == null ? [] : [`${target.tabId}:${target.sessionId}`]),
    ...(target.targetId == null ? [] : [`${target.tabId}:${target.targetId}`])
  ]
  return result.length === 0 ? [String(target.tabId)] : result
}
export function selectorKeyMatches(key: string, parent: string) {
  return key === parent || key.startsWith(parent + ':')
}
export function selectorNodeAttribute(attributes: string[], name: string) {
  for (let i = 0; i < attributes.length; i += 2)
    if (attributes[i] === name) return attributes[i + 1]
}
interface SelectorFrameTree<T> {
  frame: T
  childFrames?: SelectorFrameTree<T>[]
}
export function selectorFrames<T>(tree: SelectorFrameTree<T>): T[] {
  return [tree.frame, ...(tree.childFrames ?? []).flatMap(selectorFrames)]
}
export function remainingSelector(selector: string, count: number) {
  return selector
    .split(' >> internal:control=enter-frame >> ')
    .slice(count)
    .join(' >> internal:control=enter-frame >> ')
}
export function isBlankSelectorFrame(url: string | null | undefined) {
  if (!url) return false
  try {
    return ['about:', 'data:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
export function selectorTelemetry(input: { operation?: string; phase?: string }) {
  return {
    'browser_use.playwright.operation': input.operation,
    'browser_use.playwright.phase': input.phase
  }
}
export function selectorOperation(attrs: Record<string, unknown> | undefined) {
  const value = attrs?.['browser_use.playwright.operation']
  return typeof value === 'string' ? value : undefined
}
