import { performVirtualClipboardShortcut } from './service-playwright-clipboard-shortcut.js'
import type { PlaywrightInput } from './service-playwright-input.js'
import { clipboardShortcut, dispatchKeys } from './service-keyboard-input.js'
interface Params {
  tab_id: number
  selector: string
  value: string
  timeout_ms?: number | undefined
}
interface Context {
  playwright: PlaywrightInput
  cdp: Parameters<typeof dispatchKeys>[0] &
    Parameters<typeof performVirtualClipboardShortcut>[2]['cdp']
  clipboard: Parameters<typeof performVirtualClipboardShortcut>[2]['clipboard']
}
export async function pressLocator(params: Params, context: Context) {
  if (typeof params.value !== 'string' || !params.value)
    throw Error('playwright_locator_press requires value')
  const id = Number(params.tab_id)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  const deadlineMs =
    Date.now() +
    Math.min(Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 3000), 3000)
  const action = clipboardShortcut(params.value)
  if (action != null) {
    if (action === 'blocked')
      throw Error(
        'Native clipboard shortcuts are disabled; use Browser Use virtual clipboard commands instead.'
      )
    await performVirtualClipboardShortcut(action, id, context, () =>
      context.playwright.focusLocator(params, { requireEditable: false })
    )
    return {}
  }
  const focused = await context.playwright.focusLocator(params, { requireEditable: false })
  await dispatchKeys(context.cdp, focused.target, params.value, {
    deadlineMs,
    ...(focused.inputTargetToken == null ? {} : { inputTargetToken: focused.inputTargetToken }),
    blockClosedShadowInput: focused.blockClosedShadowInput
  })
  return {}
}
