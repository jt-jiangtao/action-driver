interface Item {
  entries: { mime_type: string; text?: string; base64?: string }[]
  presentation_style: 'unspecified'
}
interface Policy {
  attributes: string[]
  pattern: string
}
interface Input {
  action: 'copy' | 'cut'
  clipboardItems: Item[]
  protectedCredentialFieldPolicy: Policy
  cutToken?: string
  iabInputTargetToken?: string
  requireDocumentFocus?: boolean
}
/** Browser-realm copy/cut. A cut is only applied by commitVirtualCut after the host has stored its virtual clipboard. */
export async function copyOrCutPage(args: Input) {
  const localName = Object.getOwnPropertyDescriptor(window.Element.prototype, 'localName')?.get,
    namespace = Object.getOwnPropertyDescriptor(window.Element.prototype, 'namespaceURI')?.get
  if (localName == null || namespace == null)
    throw Error('Browser Use virtual clipboard requires native DOM getters')
  const native = (element: any) => {
    if (element == null) return null
    try {
      localName.call(element)
    } catch {
      return null
    }
    return element.ownerDocument.defaultView == null ? null : element
  }
  const html = (element: any) => namespace.call(element) === 'http://www.w3.org/1999/xhtml'
  const named = (element: any, name: string) => html(element) && localName.call(element) === name
  const active = (root: any): any => {
    const element = native(root.activeElement)
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
  const element = active(document) ?? document.body,
    subject = native(element),
    view = subject?.ownerDocument.defaultView ?? window
  if (args.iabInputTargetToken != null) {
    const documentFocused = args.requireDocumentFocus === true ? document.hasFocus() : null
    if (
      documentFocused === false ||
      subject?.__codexIabInputTargetToken !== args.iabInputTargetToken
    )
      throw Error(
        `Active element is no longer the expected input target: ${documentFocused === false ? 'document is not focused' : 'target token mismatch'}`
      )
  }
  delete (globalThis as any).__browserUsePendingCut
  const policy = args.protectedCredentialFieldPolicy
  if (policy == null) throw Error('Virtual clipboard is missing credential protection')
  const sensitive = (element: any) =>
    element?.tagName?.toLowerCase() === 'input' &&
    (element.getAttribute('type')?.toLowerCase() === 'hidden' ||
      new RegExp(policy.pattern, 'i').test(
        policy.attributes.map((name) => element.getAttribute(name) ?? '').join(' ')
      ))
  if (subject != null && sensitive(subject)) return {}
  const item = (text: string, htmlText: string): Item[] => {
    const entries: Item['entries'] = []
    if (text.length > 0) entries.push({ mime_type: 'text/plain', text })
    if (htmlText.length > 0) entries.push({ mime_type: 'text/html', text: htmlText })
    return entries.length ? [{ entries, presentation_style: 'unspecified' }] : []
  }
  const inputEvent = (view: any, name: string) =>
    new view.InputEvent(name, {
      bubbles: true,
      cancelable: name === 'beforeinput',
      composed: true,
      inputType: 'deleteByCut'
    })
  let selection: { items: Item[]; delete: () => void } | null = null
  if (subject != null) {
    if (named(subject, 'textarea') || named(subject, 'input')) {
      const start = subject.selectionStart,
        end = subject.selectionEnd
      if (start != null && end != null && start !== end) {
        const selected = subject.value.slice(start, end)
        selection = {
          items: item(selected, ''),
          delete: () => {
            if (
              subject.disabled ||
              subject.readOnly ||
              subject.value.slice(start, end) !== selected ||
              !subject.dispatchEvent(inputEvent(view, 'beforeinput'))
            )
              return
            subject.setRangeText('', start, end, 'end')
            subject.dispatchEvent(inputEvent(view, 'input'))
          }
        }
      }
    } else {
      const found = view.getSelection?.()
      if (found != null && found.rangeCount > 0 && !found.isCollapsed) {
        const ranges = Array.from({ length: found.rangeCount }, (_, index) =>
            found.getRangeAt(index).cloneRange()
          ),
          container = subject.ownerDocument.createElement('div')
        for (const range of ranges) container.append(range.cloneContents())
        for (const field of container.querySelectorAll('input[value]'))
          if (sensitive(field)) field.removeAttribute('value')
        const text = found.toString()
        let editable: any = null
        if (html(subject) && subject.isContentEditable) {
          editable = subject
          while (editable.parentElement?.isContentEditable) editable = editable.parentElement
        }
        selection = {
          items: item(text, container.innerHTML),
          delete: () => {
            if (
              editable == null ||
              !editable.isConnected ||
              !editable.isContentEditable ||
              !ranges.every((range) => editable.contains(range.commonAncestorContainer)) ||
              ranges.map((range) => range.toString()).join('') !== text ||
              !subject.dispatchEvent(inputEvent(view, 'beforeinput'))
            )
              return
            for (const range of ranges.reverse()) range.deleteContents()
            subject.dispatchEvent(inputEvent(view, 'input'))
          }
        }
      }
    }
  }
  const transfer = new view.DataTransfer(),
    event = new view.ClipboardEvent(args.action, {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
      composed: true
    })
  if (!element.dispatchEvent(event)) {
    const entries: Item['entries'] = []
    for (const type of Array.from(transfer.types as string[]))
      if (type !== 'Files') entries.push({ mime_type: type, text: transfer.getData(type) })
    for (const file of Array.from(transfer.files as any[]))
      if (file.type.length > 0) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let encoded = ''
        for (let offset = 0; offset < bytes.length; offset += 32768)
          encoded += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
        entries.push({ mime_type: file.type, base64: btoa(encoded) })
      }
    if (!entries.length) return {}
    for (const entry of entries)
      if (
        entry.mime_type === 'text/html' &&
        typeof entry.text === 'string' &&
        /<input[\s/>]/i.test(entry.text)
      ) {
        const template = view.document.createElement('template')
        template.innerHTML = entry.text
        let changed = false
        for (const field of template.content.querySelectorAll('input[value]'))
          if (sensitive(field)) {
            field.removeAttribute('value')
            changed = true
          }
        if (changed) entry.text = template.innerHTML
      }
    return { items: [{ entries, presentation_style: 'unspecified' }] }
  }
  if (selection == null || !selection.items.length) return {}
  if (args.action === 'cut') {
    if (args.cutToken == null) throw Error('Browser Use virtual cut is missing a commit token')
    ;(globalThis as any).__browserUsePendingCut = { commit: selection.delete, token: args.cutToken }
  }
  return { items: selection.items, ...(args.action === 'cut' ? { cutToken: args.cutToken } : {}) }
}
export function commitVirtualCut(args: { cutToken: string }) {
  const world = globalThis as typeof globalThis & {
      __browserUsePendingCut?: { token: string; commit: () => void }
    },
    pending = world.__browserUsePendingCut
  if (pending?.token !== args.cutToken) throw Error('Browser Use virtual cut is no longer pending')
  delete world.__browserUsePendingCut
  pending.commit()
}
