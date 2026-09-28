import type { ViewportClip } from './service-dom-state.js'
interface Options {
  maxChars: number
  maxElements: number
  viewportClip: ViewportClip | undefined
  reviewerOnly: boolean
}
/** Self-contained page program; DOM identity is retained only in its isolated world. */
function visibleDomPage(options: Options) {
  const interactiveTags = new Set([
      'a',
      'button',
      'details',
      'input',
      'option',
      'select',
      'summary',
      'textarea'
    ]),
    roles = new Set([
      'button',
      'checkbox',
      'combobox',
      'link',
      'menuitem',
      'option',
      'radio',
      'slider',
      'spinbutton',
      'switch',
      'tab',
      'textbox'
    ]),
    attributes = [
      'aria-disabled',
      'aria-label',
      'contenteditable',
      'href',
      'name',
      'placeholder',
      'role',
      'title',
      'type',
      'value'
    ],
    booleanAttributes = ['checked', 'disabled', 'multiple', 'readonly', 'required', 'selected'],
    overlay = 'codex-agent-overlay-root'
  const sensitive = (node: Element) => {
    if (!['input', 'textarea', 'select'].includes(node.tagName.toLowerCase())) return false
    if (node.getAttribute('type')?.toLowerCase() === 'hidden') return true
    return /user[-_ ]?name|e[-_ ]?mail|one[-_ ]?time[-_ ]?code|password|passcode|passwd|\botp\b|\b(?:2fa|mfa)\b|phone|mobile|\btel\b/i.test(
      ['type', 'autocomplete', 'id', 'name', 'placeholder', 'aria-label', 'title']
        .map((name) => ' ' + (node.getAttribute(name) ?? ''))
        .join('')
    )
  }
  const global = globalThis as typeof globalThis & Record<string, unknown>,
    key = options.reviewerOnly
      ? '__browserUseReviewerVisibleDomState'
      : '__browserUseVisibleDomState'
  const state = (global[key] ??= {
    elementToRef: new WeakMap<Element, string>(),
    nextId: 1,
    refToElement: new Map<string, Element>()
  }) as {
    elementToRef: WeakMap<Element, string>
    nextId: number
    refToElement: Map<string, Element>
  }
  state.refToElement.clear()
  const visual = window.visualViewport,
    viewport = visual
      ? {
          left: visual.offsetLeft,
          right: visual.offsetLeft + visual.width,
          top: visual.offsetTop,
          bottom: visual.offsetTop + visual.height
        }
      : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight },
    clip =
      options.viewportClip == null
        ? viewport
        : {
            left: Math.max(viewport.left, options.viewportClip.left),
            right: Math.min(viewport.right, options.viewportClip.right),
            top: Math.max(viewport.top, options.viewportClip.top),
            bottom: Math.min(viewport.bottom, options.viewportClip.bottom)
          }
  const tag = (node: Node) =>
      (node as Element).localName?.toLowerCase() || node.nodeName.toLowerCase(),
    excluded = new Set(['noscript', 'script', 'style', 'template'])
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim(),
    escape = (text: string) =>
      text
        .replace(/[\t\n\f\r]+/g, ' ')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
  const ref = (node: Element) => {
    let value = state.elementToRef.get(node)
    if (value == null) {
      value = String(state.nextId++)
      state.elementToRef.set(node, value)
    }
    return value
  }
  const rectangle = (node: Element) => {
    const style = window.getComputedStyle(node)
    if (
      style.visibility !== 'visible' ||
      style.display === 'none' ||
      style.pointerEvents === 'none' ||
      Number(style.opacity) <= 0.01
    )
      return null
    for (const rect of node.getClientRects())
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > clip.left &&
        rect.left < clip.right &&
        rect.bottom > clip.top &&
        rect.top < clip.bottom
      )
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    return null
  }
  const interactive = (node: Element) => {
    const name = tag(node)
    if (
      node.getAttribute('aria-hidden') === 'true' ||
      node.hasAttribute('hidden') ||
      (name === 'input' && node.getAttribute('type') === 'hidden')
    )
      return false
    const editable = node.getAttribute('contenteditable'),
      role = node.getAttribute('role')
    return (
      interactiveTags.has(name) ||
      (editable != null && editable.toLowerCase() !== 'false') ||
      node.hasAttribute('href') ||
      node.hasAttribute('onclick') ||
      (role != null && roles.has(role.trim().toLowerCase())) ||
      Number(node.getAttribute('tabindex') ?? -1) >= 0 ||
      (options.reviewerOnly &&
        Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.TEXT_NODE && (child.nodeValue ?? '').trim().length > 0
        ))
    )
  }
  const text = (node: Node) => {
    const parts: string[] = []
    let length = 0
    const visit = (current: Node) => {
      if (length >= 160) return
      if (current.nodeType === Node.TEXT_NODE) {
        const value = normalize(current.nodeValue || '')
        if (value) {
          parts.push(value)
          length += value.length + 1
        }
        return
      }
      if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as Element
        if (
          excluded.has(tag(element)) ||
          (options.reviewerOnly &&
            (tag(element) === 'textarea' ||
              element.getAttribute('aria-hidden') === 'true' ||
              element.hasAttribute('hidden')))
        )
          return
      }
      if (current instanceof HTMLTextAreaElement) {
        if (sensitive(current)) return
        const value = normalize(current.value)
        if (value) {
          parts.push(value)
          length += value.length + 1
        }
        return
      }
      for (const child of current.childNodes || []) {
        if (length >= 160) break
        visit(child)
      }
      if (current.nodeType === Node.ELEMENT_NODE)
        for (const child of (current as Element).shadowRoot?.childNodes ?? []) {
          if (length >= 160) break
          visit(child)
        }
    }
    visit(node)
    return normalize(parts.join(' ')).slice(0, 160)
  }
  const render = (node: Element, id: string) => {
    const name = tag(node),
      fields = [`node_id=${id}`]
    for (const attr of attributes) {
      if (
        attr === 'value' &&
        (sensitive(node) ||
          (options.reviewerOnly && ['input', 'textarea', 'select'].includes(name)))
      ) {
        if (
          !options.reviewerOnly &&
          (node instanceof HTMLInputElement ||
            node instanceof HTMLTextAreaElement ||
            node instanceof HTMLSelectElement) &&
          node.value
        )
          fields.push('value="<redacted>"')
        continue
      }
      const value =
        attr === 'value' &&
        ((node instanceof HTMLInputElement && !['checkbox', 'radio'].includes(node.type)) ||
          node instanceof HTMLSelectElement)
          ? node.value
          : node.getAttribute(attr)
      if (value != null && value !== '') fields.push(`${attr}="${escape(value)}"`)
    }
    for (const attr of booleanAttributes)
      if (
        attr === 'checked' && node instanceof HTMLInputElement
          ? node.checked
          : attr === 'selected' && node instanceof HTMLOptionElement
            ? node.selected
            : node.hasAttribute(attr)
      )
        fields.push(`${attr}="true"`)
    if (node instanceof HTMLInputElement && node.indeterminate) fields.push('indeterminate="true"')
    const content = text(node)
    return content
      ? `<${name} ${fields.join(' ')}>${escape(content)}</${name}>`
      : `<${name} ${fields.join(' ')} />`
  }
  const items: { ref: string; line: string }[] = [],
    frames: {
      ref: string
      rect: ViewportClip
      size: { width: number; height: number }
      url?: string
    }[] = []
  let chars = 0,
    truncated = false
  const full = () => truncated || items.length >= options.maxElements || chars >= options.maxChars
  const add = (node: Element) => {
    if (full()) return
    const id = ref(node),
      line = render(node, id),
      size = line.length + (items.length === 0 ? 0 : 1)
    if (chars + size > options.maxChars) {
      truncated = true
      return
    }
    items.push({ line, ref: id })
    state.refToElement.set(id, node)
    chars += size
  }
  const addFrame = (node: Element) => {
    if (frames.length >= options.maxElements) return
    const rect = rectangle(node)
    if (rect == null) return
    const id = ref(node)
    if (frames.some((frame) => frame.ref === id)) return
    const src = (node as HTMLIFrameElement).src,
      width = node.clientWidth > 0 ? node.clientWidth : rect.right - rect.left,
      height = node.clientHeight > 0 ? node.clientHeight : rect.bottom - rect.top
    frames.push({ rect, ref: id, size: { height, width }, ...(src.length > 0 ? { url: src } : {}) })
    state.refToElement.set(id, node)
  }
  if (options.reviewerOnly)
    for (const node of document.querySelectorAll('iframe, frame'))
      if (node.closest('#' + overlay) == null) addFrame(node)
  const walk = (node: Node) => {
    if (full()) return
    if (node.nodeType === Node.DOCUMENT_NODE) {
      const root = (node as Document).documentElement
      if (root) walk(root)
      return
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of (node as DocumentFragment).children) {
        if (full()) break
        walk(child)
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (element.getAttribute('id') === overlay) return
    if (['frame', 'iframe'].includes(tag(element))) addFrame(element)
    if (interactive(element) && rectangle(element) != null) add(element)
    if (element.shadowRoot && !full()) walk(element.shadowRoot)
    for (const child of element.children) {
      if (full()) break
      walk(child)
    }
  }
  walk(document)
  return { frameElements: frames, items, viewport }
}
export function visibleDomExpression(
  maxChars: number,
  maxElements: number,
  viewportClip: ViewportClip | undefined,
  reviewerOnly: boolean
) {
  return `(() => { const __name = (target) => target; return (${visibleDomPage.toString()})(${JSON.stringify({ maxChars, maxElements, viewportClip, reviewerOnly })}); })()`
}
