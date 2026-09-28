import type { BrowserCdp } from './service-cdp.js'
import type { ServiceClipboard } from './service-clipboard.js'
import type { CdpTarget } from './service-cdp-execution.js'
import type { CdpEvent } from './service-cdp-events.js'
interface InteractionContext {
  cdp: BrowserCdp
  clipboard: ServiceClipboard
}
interface Params {
  tab_id: number | string
  text?: string
  items?: unknown
  dialog_id?: string
  action?: string
  prompt_text?: string
}
function tabId(value: number | string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw Error('Expected a positive integer')
  return id
}
async function clipboard<T>(params: Params, context: InteractionContext, run: () => T) {
  await context.clipboard.ensurePageClipboard(context.cdp, { tabId: tabId(params.tab_id) })
  return await context.clipboard.runExclusive(async () => run())
}
function dialogClosed(event: CdpEvent, target: CdpTarget) {
  return (
    event.method === 'Page.javascriptDialogClosed' &&
    (target.sessionId != null
      ? event.source.sessionId === target.sessionId
      : event.source.tabId === target.tabId && event.source.sessionId == null)
  )
}
async function closeDialog(
  context: InteractionContext,
  id: number,
  key: string,
  target: CdpTarget,
  params: Record<string, unknown>
) {
  const abort = new AbortController()
  let settled = false
  const action = context.cdp.callTarget(target, 'Page.handleJavaScriptDialog', params).then(
      (value) => {
        settled = true
        return value
      },
      (error) => {
        settled = true
        throw error
      }
    ),
    closed = context.cdp
      .waitForEvent(id, (event) => dialogClosed(event, target), {
        signal: abort.signal,
        timeoutMessage: 'Timed out waiting for JavaScript dialog to close.',
        timeoutMs: 60000
      })
      .then(() => {})
  try {
    await Promise.race([closed, action.then(async () => await closed)])
    context.cdp.deleteJsDialog(id, key)
  } finally {
    abort.abort()
    if (!settled) void action.catch(() => {})
  }
}
export const interactionCommandHandlers = {
  tab_clipboard_read: async (params: Params, context: InteractionContext) =>
    await clipboard(params, context, () => ({ items: context.clipboard.read() })),
  tab_clipboard_read_text: async (params: Params, context: InteractionContext) =>
    await clipboard(params, context, () => ({
      text:
        context.clipboard
          .read()
          .flatMap((item) => item.entries)
          .find((entry) => entry.mime_type === 'text/plain')?.text ?? ''
    })),
  tab_clipboard_write: async (params: Params, context: InteractionContext) =>
    await clipboard(params, context, () => {
      context.clipboard.write(params.items, 'tab_clipboard_write')
      return {}
    }),
  tab_clipboard_write_text: async (params: Params, context: InteractionContext) => {
    tabId(params.tab_id)
    if (typeof params.text !== 'string') throw Error('tab_clipboard_write_text requires text')
    return await clipboard(params, context, () => {
      context.clipboard.write(
        [
          {
            entries: [{ mime_type: 'text/plain', text: params.text }],
            presentation_style: 'unspecified'
          }
        ],
        'tab_clipboard_write_text'
      )
      return {}
    })
  },
  tab_get_js_dialog: async (params: Params, context: InteractionContext) => {
    const dialog = context.cdp.getJsDialog(tabId(params.tab_id))
    return { dialog: dialog == null ? null : { id: dialog.id, type: dialog.type } }
  },
  tab_handle_js_dialog: async (params: Params, context: InteractionContext) => {
    const id = tabId(params.tab_id),
      key = params.dialog_id!,
      dialog = context.cdp.activeJsDialog(id, key)
    if (params.action === 'accept') {
      if (dialog.type === 'alert' || dialog.type === 'beforeunload')
        throw Error(`Dialog type ${dialog.type} does not support accept()`)
      if (dialog.type === 'confirm' && params.prompt_text != null)
        throw Error('Confirm dialogs do not accept prompt text')
      let input: Record<string, unknown> = { accept: true }
      if (dialog.type === 'prompt') {
        if (typeof params.prompt_text !== 'string')
          throw Error('Prompt dialogs require prompt text')
        input = { accept: true, promptText: params.prompt_text }
      }
      await closeDialog(context, id, key, dialog.target, input)
      return {}
    }
    if (params.action === 'dismiss') {
      await closeDialog(context, id, key, dialog.target, { accept: dialog.type === 'alert' })
      return {}
    }
    throw Error(`Unsupported dialog action: ${String(params.action)}`)
  }
}
