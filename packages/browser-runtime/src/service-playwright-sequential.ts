import type { PlaywrightInput } from './service-playwright-input.js'
import { dispatchCharacter } from './service-keyboard-input.js'
interface Params {
  tab_id: number
  selector: string
  value: string
  timeout_ms?: number | undefined
}
interface Context {
  playwright: PlaywrightInput
  cdp: Parameters<typeof dispatchCharacter>[0]
}
/** A document-bound focus token is verified immediately before each native character dispatch. */
export async function pressSequentially(params: Params, context: Context) {
  if (typeof params.value !== 'string')
    throw Error('playwright_locator_press_sequentially requires string value')
  const deadlineMs =
      Date.now() +
      Math.min(Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 5000), 5000),
    prepared = await context.playwright.prepareSequentialInput(params, deadlineMs),
    { target, targetToken } = prepared,
    characters = Array.from(params.value)
  try {
    for (const [index, character] of characters.entries()) {
      const current = await context.playwright.evaluateOnPlaywrightSelectorWithTarget(
        params.tab_id,
        params.selector,
        (element: any, injected: any, arg: any, scope: any) => {
          const input =
            typeof injected.retarget === 'function'
              ? injected.retarget(element, 'follow-label')
              : element
          if (input == null) return false
          const focused = (node: any) => {
            for (let current = node; current != null; ) {
              const root = current.getRootNode?.()
              if (root == null || root.activeElement !== current) return false
              if (!('host' in root)) return true
              current = root.host
            }
            return false
          }
          return (
            Object.getOwnPropertyDescriptor(input, '__codexPressSequentiallyTargetToken')?.value ===
              arg.targetToken &&
            (input.matches(':focus') || focused(input)) &&
            scope.frameChain.every(({ element: frame }: any) => focused(frame))
          )
        },
        { arg: { targetToken }, deadlineMs, retry: false, timeoutMs: params.timeout_ms }
      )
      if (
        !current.result ||
        target.tabId !== current.target.tabId ||
        target.sessionId !== current.target.sessionId ||
        target.targetId !== current.target.targetId
      )
        throw Error('pressSequentially target changed or lost focus while typing')
      await dispatchCharacter(context.cdp, target, character, {
        deadlineMs,
        blockClosedShadowInput: prepared.blockClosedShadowInput,
        ...(prepared.inputTargetToken == null
          ? {}
          : { inputTargetToken: prepared.inputTargetToken })
      })
      if (index < characters.length - 1) await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } finally {
    await context.playwright
      .evaluateOnPlaywrightSelector(
        params.tab_id,
        params.selector,
        (element: any, injected: any, arg: any) => {
          const input =
            typeof injected.retarget === 'function'
              ? injected.retarget(element, 'follow-label')
              : element
          if (
            input != null &&
            Object.getOwnPropertyDescriptor(input, '__codexPressSequentiallyTargetToken')?.value ===
              arg.targetToken
          )
            Reflect.deleteProperty(input, '__codexPressSequentiallyTargetToken')
        },
        { arg: { targetToken }, retry: false, timeoutMs: 500 }
      )
      .catch(() => {})
  }
  return {}
}
