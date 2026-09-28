/** Self-contained browser-realm setter; serialized into Runtime.callFunctionOn. */
export function setAxValuePage(this: any, args: { value: string }): 'done' | 'needs-click' {
  const value = args.value, role = this.getAttribute('role')
  const assertReady = (label: string, checkReadonly = false) => {
    if (!this.isConnected) throw Error(`${label} is no longer connected`)
    if (this.matches(':disabled') || this.getAttribute('aria-disabled') === 'true') throw Error(`${label} is disabled`)
    if (checkReadonly && (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) && this.readOnly)
      throw Error(`${label} is read-only`)
  }
  const announce = () => {
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (this instanceof HTMLInputElement && (this.type === 'checkbox' || this.type === 'radio')) {
    const label = this.type === 'radio' ? 'Radio button' : role === 'switch' ? 'Switch' : 'Checkbox'
    if (!['0', '1', 'false', 'true'].includes(value)) throw Error(`${label} value must be 0, 1, false, or true`)
    assertReady(label)
    const checked = value === '1' || value === 'true'
    const changed = this.checked !== checked || this.type === 'checkbox' && this.indeterminate
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
    if (!setter) throw Error(`${label} native setter is unavailable`)
    this.focus(); setter.call(this, checked)
    if (this.type === 'checkbox') {
      const clear = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'indeterminate')?.set
      if (!clear) throw Error(`${label} indeterminate setter is unavailable`)
      clear.call(this, false)
    }
    if (changed) announce()
    if (!this.isConnected || this.checked !== checked || this.type === 'checkbox' && this.indeterminate)
      throw Error(`${label} did not retain the requested state`)
    return 'done'
  }
  if (this instanceof HTMLSelectElement) {
    assertReady('Select')
    if (this.multiple) throw Error('Multi-select controls are not supported')
    const options = Array.from(this.options)
    let selected = options.find(option => option.value === value)
    if (!selected) {
      const matching = options.filter(option => option.label === value || option.text === value)
      if (matching.length !== 1) throw Error(matching.length === 0 ?
        `Select option ${JSON.stringify(value)} was not found` : `Select option label ${JSON.stringify(value)} is ambiguous`)
      selected = matching[0]
    }
    if (!selected) throw Error(`Select option ${JSON.stringify(value)} was not found`)
    if (selected.disabled || selected.parentElement instanceof HTMLOptGroupElement && selected.parentElement.disabled)
      throw Error(`Select option ${JSON.stringify(value)} is disabled`)
    const setter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected')?.set
    if (!setter) throw Error('Select native option setter is unavailable')
    const changed = !selected.selected
    this.focus()
    if (!this.isConnected || !Array.from(this.options).includes(selected)) throw Error(`Select rejected option ${JSON.stringify(value)}`)
    setter.call(selected, true)
    if (changed) announce()
    if (!this.isConnected || this.selectedOptions[0] !== selected) throw Error('Select did not retain the requested option')
    return 'done'
  }
  if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
    const label = this instanceof HTMLTextAreaElement ? 'Text area' : 'Input'
    if (this instanceof HTMLInputElement && this.type === 'file') throw Error('File inputs cannot be set programmatically')
    assertReady(label, true); this.focus()
    let requested = value
    if (this instanceof HTMLInputElement && this.type === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw Error('Color value must use #rrggbb')
      requested = value.toLowerCase()
    }
    const prototype = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (!setter) throw Error(`${label} native value setter is unavailable`)
    const previous = this.value
    setter.call(this, requested)
    if (this.value !== requested) { setter.call(this, previous); throw Error(`${label} rejected value ${JSON.stringify(value)}`) }
    if (previous !== requested) announce()
    return 'done'
  }
  if (role === 'tab') {
    if (value !== '1' && value !== 'true') throw Error('Tab value must be 1 or true')
    assertReady('Tab')
    return this.getAttribute('aria-selected') === 'true' ? 'done' : 'needs-click'
  }
  if (['checkbox','radio','switch','combobox','listbox','slider','spinbutton'].includes(role ?? '') || this.hasAttribute('aria-pressed'))
    throw Error('Custom ARIA controls do not expose a standard value setter')
  if (this instanceof HTMLElement && this.isContentEditable) {
    assertReady('Editable element'); this.focus()
    const previous = this.textContent ?? ''
    this.textContent = value
    if (previous !== value) {
      this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }))
      this.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return 'done'
  }
  throw Error('Accessibility element does not expose a standard value setter')
}

/** Self-contained browser-realm text selection function. */
export function selectAxTextPage(this: any, args: {
  text: string; prefix?: string; suffix?: string; selectionType?: 'text' | 'cursor_before' | 'cursor_after'
}) {
  if (!this.isConnected) throw Error('Cannot select text in a detached element')
  const element = this instanceof Element ? this : this.parentElement
  if (element?.matches(':disabled')) throw Error('Cannot select text in a disabled element')
  if (args.text.length === 0) throw Error('Text to select must not be empty')
  const field = this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement ? this : undefined
  const content = field?.value ?? this.textContent ?? ''
  const prefix = args.prefix ?? '', needle = `${prefix}${args.text}${args.suffix ?? ''}`
  const position = content.indexOf(needle)
  if (position < 0) throw Error('Text to select was not found')
  if (content.indexOf(needle, position + 1) >= 0) throw Error('Text to select matches multiple locations')
  const start = position + prefix.length
  const from = args.selectionType === 'cursor_after' ? start + args.text.length : start
  const to = args.selectionType === 'text' ? from + args.text.length : from
  if (element instanceof HTMLElement) element.focus()
  if (field) { field.setSelectionRange(from, to); return }
  const walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0, hasStart = false
  let node: any = this instanceof Text ? this : walker.nextNode()
  while (node != null) {
    const end = offset + (node.textContent?.length ?? 0)
    if (!hasStart && from <= end) { range.setStart(node, Math.max(from - offset, 0)); hasStart = true }
    if (hasStart && to <= end) {
      range.setEnd(node, Math.max(to - offset, 0))
      const selection = window.getSelection()
      if (!selection) throw Error('Could not select element text')
      selection.removeAllRanges(); selection.addRange(range)
      return
    }
    offset = end; node = walker.nextNode()
  }
  throw Error('Selection range is outside the target element')
}
