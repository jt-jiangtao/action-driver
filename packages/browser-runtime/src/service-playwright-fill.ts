import type { PlaywrightInput } from './service-playwright-input.js'
import { pastePage, runClipboardPageAction } from './service-playwright-paste.js'
interface Params {
  tab_id: number
  selector: string
  value: unknown
  replace?: boolean
  timeout_ms?: number | undefined
}
interface Context {
  playwright: PlaywrightInput
  cdp: Parameters<typeof runClipboardPageAction>[0]['ctx']['cdp']
  clipboard: Parameters<typeof runClipboardPageAction>[0]['ctx']['clipboard'] & {
    runExclusive<T>(run: () => Promise<T>): Promise<T>
  }
}
export async function fillLocator(params: Params, context: Context) {
  if (typeof params.value !== 'string') throw Error('playwright_locator_fill requires string value')
  const replace = params.replace !== false,
    prepared = replace
      ? await context.playwright.prepareLocatorFill(
          params as Params & { value: string },
          params.value
        )
      : await context.playwright.focusLocator(params as Params & { value: string }, {
          requireEditable: true
        })
  if ('result' in prepared && prepared.result === 'done') return {}
  const id = Number(params.tab_id)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  await context.clipboard.runExclusive(
    async () =>
      await runClipboardPageAction({
        args: {
          action: 'paste',
          clipboardItems: [
            {
              entries: [{ mime_type: 'text/plain', text: params.value }],
              presentation_style: 'unspecified'
            }
          ],
          ...(prepared.inputTargetToken == null
            ? {}
            : { iabInputTargetToken: prepared.inputTargetToken }),
          replaceInputValue: replace,
          requireDocumentFocus: prepared.executionContextId != null
        },
        commandType: 'playwright_locator_fill',
        ctx: context,
        pageFunction: pastePage,
        tabId: id,
        target: prepared.target,
        executionContextId: prepared.executionContextId
      })
  )
  return {}
}
