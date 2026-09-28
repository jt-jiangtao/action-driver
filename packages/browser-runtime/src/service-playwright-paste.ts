/** Browser-realm virtual paste function; no module imports may be captured when serialized. */
export async function pastePage(args: {
  action: 'paste'
  clipboardItems: { entries: { mime_type: string; text?: string }[] }[]
  iabInputTargetToken?: string
  replaceInputValue?: boolean
  requireDocumentFocus?: boolean
  richTextFallback?: boolean
}) {
  const localName = Object.getOwnPropertyDescriptor(window.Element.prototype, 'localName')?.get,
    namespace = Object.getOwnPropertyDescriptor(window.Element.prototype, 'namespaceURI')?.get
  if (localName == null || namespace == null)
    throw Error('Browser Use virtual clipboard requires native DOM getters')
  const nativeElement = (node: any) => {
    if (node == null) return null
    try {
      localName.call(node)
    } catch {
      return null
    }
    return node.ownerDocument.defaultView == null ? null : node
  }
  const html = (node: any) => namespace.call(node) === 'http://www.w3.org/1999/xhtml'
  const named = (node: any, name: string) => html(node) && localName.call(node) === name
  const active = (root: any): any => {
    const element = nativeElement(root.activeElement)
    if (element == null) return null
    if (html(element) && element.shadowRoot != null) return active(element.shadowRoot) ?? element
    if (named(element, 'iframe') || named(element, 'frame'))
      try {
        const doc = element.contentDocument ?? element.contentWindow?.document ?? null
        if (doc != null) return active(doc) ?? element
      } catch {
        return element
      }
    return element
  }
  const element = active(document) ?? document.body
  if (args.iabInputTargetToken != null) {
    const focused = nativeElement(element),
      documentFocused = args.requireDocumentFocus === true ? document.hasFocus() : null
    if (
      documentFocused === false ||
      focused?.__codexIabInputTargetToken !== args.iabInputTargetToken
    )
      throw Error(
        `Active element is no longer the expected input target: ${documentFocused === false ? 'document is not focused' : 'target token mismatch'}`
      )
  }
  const target = nativeElement(element),
    view = target?.ownerDocument.defaultView ?? window
  if (args.clipboardItems.length === 0)
    throw Error('Browser Use virtual clipboard has no data to paste')
  const entry = (mime: string) =>
    args.clipboardItems.flatMap((item) => item.entries).find((entry) => entry.mime_type === mime)
      ?.text ?? ''
  const plain = entry('text/plain'),
    rich = args.richTextFallback === true ? entry('text/html') : ''
  const insert = (target: any, htmlText: string, text: string, replace: boolean) => {
    const element = nativeElement(target)
    if (element == null) return
    const view = element.ownerDocument.defaultView ?? window
    if (named(element, 'textarea') || named(element, 'input')) {
      if (element.disabled || element.readOnly || (text.length === 0 && !replace)) return
      const set = (value: string) => {
        const own = Object.getOwnPropertyDescriptor(element, 'value')?.set,
          base = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
        if (base != null && own !== base) {
          base.call(element, value)
          return
        }
        element.value = value
      }
      if (element.selectionStart == null || element.selectionEnd == null)
        set(replace ? text : element.value + text)
      else {
        const start = element.selectionStart ?? element.value.length,
          end = element.selectionEnd ?? element.value.length
        try {
          element.setRangeText(text, start, end, 'end')
        } catch {
          set(replace ? text : element.value + text)
        }
      }
      element.dispatchEvent(new view.InputEvent('input', { bubbles: true }))
      return
    }
    if (html(element) && (element.isContentEditable || element.closest('[contenteditable=true]'))) {
      if ((element.focus(), htmlText.length > 0)) {
        element.ownerDocument.execCommand('insertHTML', false, htmlText)
        return
      }
      if (text.length > 0 || replace) element.ownerDocument.execCommand('insertText', false, text)
    }
  }
  if (typeof view.DataTransfer !== 'function' || typeof view.ClipboardEvent !== 'function') {
    insert(element, rich, plain, args.replaceInputValue === true)
    return {}
  }
  const transfer = new view.DataTransfer()
  transfer.clearData()
  for (const item of args.clipboardItems)
    for (const entry of item.entries) {
      if (typeof entry.text === 'string') {
        transfer.setData(entry.mime_type, entry.text)
        continue
      }
      const kind = entry.mime_type.split('/')[1] ?? 'bin'
      const value = atob((entry as any).base64 ?? '')
      const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0))
      transfer.items.add(
        new view.File([bytes.buffer], `clipboard.${kind}`, { type: entry.mime_type })
      )
    }
  const event = new view.ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: transfer,
    composed: true
  })
  if (element.dispatchEvent(event)) insert(element, rich, plain, args.replaceInputValue === true)
  return {}
}
export async function runClipboardPageAction(input: {
  args: unknown
  commandType: string
  ctx: {
    clipboard: {
      ensurePageClipboard(
        cdp: unknown,
        target: { tabId: number; sessionId?: string; targetId?: string }
      ): Promise<unknown>
    }
    cdp: {
      callTarget(
        target: { tabId: number; sessionId?: string; targetId?: string },
        method: string,
        params: Record<string, unknown>
      ): Promise<any>
    }
  }
  pageFunction: (args: any) => Promise<unknown>
  tabId: number
  target?: { tabId: number; sessionId?: string; targetId?: string }
  executionContextId?: number | undefined
}) {
  const target = input.target ?? { tabId: input.tabId }
  await input.ctx.clipboard.ensurePageClipboard(input.ctx.cdp, target)
  const response = await input.ctx.cdp.callTarget(target, 'Runtime.evaluate', {
    expression: `(
          async () => {
            try {
              const __name = (target) => target;
              const pageFunction = ${input.pageFunction.toString()};
              const data = await pageFunction(${JSON.stringify(input.args)});
              return { ok: true, data };
            } catch (error) {
              return {
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),
              };
            }
          }
        )()`,
    awaitPromise: true,
    ...(input.executionContextId == null ? {} : { contextId: input.executionContextId }),
    returnByValue: true
  })
  if (response.exceptionDetails != null) {
    const detail = String(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.exception?.value ??
        response.exceptionDetails.text ??
        `${input.commandType} failed`
    )
    throw Error(
      `Browser Use encountered an error interacting with this webpage's clipboard: ${detail}`
    )
  }
  const result = response.result?.value
  if (result == null || typeof result !== 'object' || !('ok' in result))
    throw Error(
      `Browser Use encountered an error interacting with this webpage's clipboard: ${input.commandType} returned an invalid result`
    )
  if (result.ok !== true) {
    const detail = typeof result.error === 'string' ? result.error : `${input.commandType} failed`
    throw Error(
      `Browser Use encountered an error interacting with this webpage's clipboard: ${detail}`
    )
  }
  return 'data' in result ? result.data : undefined
}
