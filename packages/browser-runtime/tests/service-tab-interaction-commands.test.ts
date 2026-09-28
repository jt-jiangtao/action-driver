// @vitest-environment node
import { test, expect } from 'vitest'
import { interactionCommandHandlers } from '../src/service-tab-interaction-commands'
import { ServiceClipboard } from '../src/service-clipboard'
import { originalDocumentation } from './original-service'
test('clipboard command handlers serialize virtual reads and writes through installed page bridge', async () => {
  const base = await originalDocumentation(),
    baseline = {
      tab_clipboard_write_text: base.baselineClipboardWriteText,
      tab_clipboard_read_text: base.baselineClipboardReadText,
      tab_clipboard_write: base.baselineClipboardWrite,
      tab_clipboard_read: base.baselineClipboardRead
    }
  async function exercise(original: boolean) {
    const calls: any[] = [],
      clipboard = original ? new base.BaselineClipboard() : new ServiceClipboard()
    // Installation is tested separately; this boundary records command-to-bridge ownership.
    clipboard.ensurePageClipboard = async (...args: any[]) => calls.push(args)
    const context = { clipboard, cdp: {} },
      results: any[] = []
    for (const type of Object.keys(baseline))
      results.push(
        await (
          original
            ? baseline[type as keyof typeof baseline]
            : interactionCommandHandlers[type as keyof typeof interactionCommandHandlers]
        )(
          {
            tab_id: 1,
            text: 'hello',
            items: [
              {
                entries: [{ mime_type: 'text/plain', text: 'changed' }],
                presentation_style: 'inline'
              }
            ]
          },
          context as any
        )
      )
    return { results, calls }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('dialog command handlers enforce type/action/prompt contracts and match closing frame ownership', async () => {
  const base = await originalDocumentation()
  for (const type of ['alert', 'confirm', 'prompt', 'beforeunload'])
    for (const action of ['accept', 'dismiss', 'unknown'])
      for (const prompt_text of [undefined, 'answer']) {
        async function exercise(run: any) {
          const calls: any[] = [],
            target = { tabId: 1, sessionId: 'frame' },
            context = {
              cdp: {
                activeJsDialog: () => ({ type, target }),
                callTarget: async (...args: any[]) => calls.push(['call', ...args]),
                waitForEvent: async (_id: number, predicate: any, options: any) => {
                  expect(
                    predicate({
                      method: 'Page.javascriptDialogClosed',
                      source: { tabId: 1, sessionId: 'other' }
                    })
                  ).toBe(false)
                  expect(predicate({ method: 'Page.javascriptDialogClosed', source: target })).toBe(
                    true
                  )
                  options.signal.addEventListener('abort', () => calls.push(['abort']))
                },
                deleteJsDialog: (...args: any[]) => calls.push(['delete', ...args])
              }
            }
          let result, error
          try {
            result = await run({ tab_id: 1, dialog_id: 'd', action, prompt_text }, context)
          } catch (e: any) {
            error = e.message
          }
          return { result, error, calls }
        }
        expect(await exercise(interactionCommandHandlers.tab_handle_js_dialog)).toEqual(
          await exercise(base.baselineHandleDialog)
        )
      }
})
