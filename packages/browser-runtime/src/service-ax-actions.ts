import { selectAxTextPage, setAxValuePage } from './service-ax-page.js'
import { AxHitTest } from './service-ax-hit-test.js'
/** Input preparation failed before any bytes were dispatched. */
export class AxInputPreparationError extends Error {}
/** AX action sequencer. CDP/UI dependencies are supplied by the concrete service. */
export class AxActions {
  private pendingTyping = new Map<number, Promise<void>>()
  private hitTest: AxHitTest
  constructor(readonly context: any) { this.hitTest = new AxHitTest(context) }
  async perform(tabId: number, action: any): Promise<void> {
    const dialog = this.context.cdp.getJsDialog(tabId)
    if (dialog != null) return this.performDialog(tabId, action, dialog.id)
    const abort = new AbortController()
    await this.withDialog(tabId, async () => {
      const previous = this.pendingTyping.get(tabId)
      const operation = (async () => {
        await previous
        abort.signal.throwIfAborted()
        await this.performPage(tabId, action, abort.signal)
      })()
      if (action.kind === 'type_text') {
        const settled = operation.then(() => {}, () => {}).finally(() => {
          if (this.pendingTyping.get(tabId) === settled) this.pendingTyping.delete(tabId)
        })
        this.pendingTyping.set(tabId, settled)
      }
      await operation
    }, dialog => {
      const message = /[.!?]$/.test(dialog.message) ? dialog.message : `${dialog.message}.`
      const error = Error(`Browser action "${action.kind}" interrupted by JavaScript ${dialog.type}: ${message} The action may already have taken effect; do not retry it. Inspect or dismiss the dialog before continuing.`)
      abort.abort(error)
      throw error
    })
  }
  private async withDialog(tabId: number, action: () => Promise<void>, onDialog: (dialog: any) => Promise<void>) {
    let remove = () => {}
    const appeared = new Promise<any>(resolve => {
      const handler = (event: any) => {
        if (event.method !== 'Page.javascriptDialogOpening' || event.source.tabId !== tabId || event.params.type === 'beforeunload') return
        const dialog = this.context.cdp.getJsDialog(tabId)
        if (dialog) resolve(this.context.cdp.activeJsDialog(tabId, dialog.id))
      }
      this.context.cdp.on('event', handler)
      remove = () => this.context.cdp.removeListener('event', handler)
    })
    try {
      const initial = this.context.cdp.getJsDialog(tabId)
      if (initial && initial.type !== 'beforeunload') return await onDialog(this.context.cdp.activeJsDialog(tabId, initial.id))
      const fallback = appeared.then(onDialog)
      return await Promise.race([action().catch((error: unknown) => {
        const dialog = this.context.cdp.getJsDialog(tabId)
        if (dialog && dialog.type !== 'beforeunload') return fallback
        throw error
      }), fallback])
    } finally { remove() }
  }
  private async performDialog(tabId: number, action: any, dialogId: string) {
    const dialog = this.context.cdp.activeJsDialog(tabId, dialogId)
    if (action.kind === 'click' && Array.isArray(action.target))
      throw Error('JavaScript dialog controls have no viewport coordinates; use an accessibility element index with tab.ax.click(elementIndex)')
    if (action.kind === 'click' && action.mouse_button != null && action.mouse_button !== 'left' && action.mouse_button !== 'l')
      throw Error('JavaScript dialog controls only support left clicks')
    const index = action.kind === 'click' && typeof action.target === 'number'
      ? action.target
      : ['set_value', 'paste', 'type_text', 'press_key'].includes(action.kind) ? action.element_index : null
    let control: any
    try { control = index == null ? undefined : this.context.ax.targetForElement(tabId, index).javaScriptDialog }
    catch (error) { throw new AxInputPreparationError(String(error), { cause: error }) }
    if (index != null && control == null) throw new AxInputPreparationError('A JavaScript dialog is blocking the requested page element')
    if (control != null && control.dialogID !== dialog.id) throw new AxInputPreparationError('JavaScript dialog is no longer active')
    if (action.kind === 'set_value' && control?.control === 'prompt') {
      this.context.cdp.updateJsDialogPrompt(tabId, dialog.id, action.value); return
    }
    if (action.kind === 'type_text' && dialog.type === 'prompt' && (control == null || control.control === 'prompt')) {
      this.context.cdp.updateJsDialogPrompt(tabId, dialog.id, dialog.promptText + action.text); return
    }
    let choice = action.kind === 'click' ? control?.control : undefined
    if (action.kind === 'press_key') {
      const key = action.key.toLowerCase()
      if (key === 'return' || key === 'enter') choice = control?.control === 'dismiss' ? 'dismiss' : 'accept'
      if (key === 'escape' || key === 'esc') choice = 'dismiss'
    }
    if (choice !== 'accept' && choice !== 'dismiss')
      throw Error('A JavaScript dialog is active; interact with its controls first')
    const disposition = choice === 'dismiss' || dialog.type === 'alert' ? 'dismiss' : 'accept'
    await this.context.handleJsDialog({ action: disposition, browser_id: this.context.browserId,
      dialog_id: dialog.id, prompt_text: dialog.type === 'prompt' && disposition === 'accept' ? dialog.promptText : undefined,
      tab_id: String(tabId) })
  }
  private async viewportPoint(tabId: number, coordinate: unknown) {
    if (!Array.isArray(coordinate)) throw Error('Accessibility action requires an element index or point')
    const point = { x: coordinate[0], y: coordinate[1] }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error('tab_ax_action requires finite x and y coordinates')
    const { cssVisualViewport } = await this.context.cdp.call(tabId, 'Page.getLayoutMetrics')
    if (point.x < 0 || point.y < 0 || point.x >= cssVisualViewport.clientWidth || point.y >= cssVisualViewport.clientHeight)
      throw Error('Coordinate is outside the active tab content viewport')
    return { height: cssVisualViewport.clientHeight, point, width: cssVisualViewport.clientWidth }
  }
  private async prepareFocus(tabId: number, index: number | undefined, editable: boolean) {
    if (index == null) return { target: { tabId }, executionContextId: undefined }
    try {
      const node = this.context.ax.targetForElement(tabId, index)
      return await this.context.playwright.focusNode(node, { requireEditable: editable, timeoutMs: 3000 })
    } catch (error) {
      throw new AxInputPreparationError(`Could not prepare accessibility element ${index} for input within 3000 ms. No input was sent. ${String(error)}`, { cause: error })
    }
  }
  private async typeText(tabId: number, index: number | undefined, value: string, signal: AbortSignal) {
    const focus = await this.prepareFocus(tabId, index, true)
    signal.throwIfAborted()
    const send = (event: any) => this.context.cdp.callTarget(focus.target, 'Input.dispatchKeyEvent', {
      ...event, ...(focus.inputTargetToken == null ? {} : { __codexIabExpectedInputTargetToken: focus.inputTargetToken })
    })
    for (const character of value) if (character < ' ' && !['\t','\n','\r'].includes(character))
      throw Error('AX typeText does not support control characters other than tab and newline')
    let first = true
    for (const character of value.replaceAll(/\r\n?/g, '\n')) {
      const control = character === '\n' || character === '\t', keyEvent = { key: control ? 'Unidentified' : character, windowsVirtualKeyCode: 0 }
      const bracket = first || control
      first = false
      if (bracket) { await send({ type: 'rawKeyDown', ...keyEvent,
        ...(control ? { commands: [character === '\n' ? 'insertParagraph' : 'insertTab'] } : {}) }); signal.throwIfAborted() }
      if (!control) { await send({ type: 'char', key: character, text: character, unmodifiedText: character }); signal.throwIfAborted() }
      if (bracket) await send({ type: 'keyUp', ...keyEvent })
    }
  }
  private async performPage(tabId: number, action: any, signal: AbortSignal) {
    switch (action.kind) {
      case 'click': {
        if (typeof action.target === 'number') return this.hitTest.click(tabId, action.target, { button: action.mouse_button, clickCount: action.click_count ?? 1 })
        const point = await this.viewportPoint(tabId, action.target)
        const button = action.mouse_button === 'right' || action.mouse_button === 'r' ? 'right' : action.mouse_button === 'middle' || action.mouse_button === 'm' ? 'middle' : 'left'
        return this.context.cua.clickPoint({ button, clickCount: action.click_count ?? 1, deferPageLoadWait: (load: Promise<unknown>) => this.context.ax.trackDeferredPageLoad(tabId, load), modifiers: 0, point: point.point, tabId })
      }
      case 'drag': {
        const from = (await this.viewportPoint(tabId, action.from)).point, to = (await this.viewportPoint(tabId, action.to)).point
        const path = [from, ...Array.from({ length: 8 }, (_, index) => ({ x: from.x + (to.x - from.x) * (index + 1) / 8, y: from.y + (to.y - from.y) * (index + 1) / 8 }))]
        return this.context.cua.dragPath({ modifiers: 0, path, tabId })
      }
      case 'perform_secondary_action': {
        const node = this.context.ax.targetForElement(tabId, action.element_index)
        if (!['Expand', 'Collapse'].includes(action.action) || !node.actionDescriptions.includes(action.action))
          throw Error(`Accessibility element ${action.element_index} does not support secondary action ${JSON.stringify(action.action)}`)
        return this.hitTest.click(tabId, action.element_index, { clickCount: 1 })
      }
      case 'type_text': return this.typeText(tabId, action.element_index, action.text, signal)
      case 'paste': return this.context.axInput.paste(tabId, action.element_index, action.text, action.format)
      case 'press_key': {
        const normalized = action.key.split('+').map((part: string) => part.length === 1 ? part :
          /^(alt|control|meta|super|shift)_[lr]$/i.exec(part)?.[1] ?? part.replaceAll('_', '')).join('+')
        const shortcut = this.context.keyboard.clipboardShortcut(normalized)
        if (shortcut === 'blocked') throw Error('Native clipboard shortcuts are disabled; use Browser Use virtual clipboard commands instead.')
        if (shortcut != null) {
          const focused = await this.prepareFocus(tabId, action.element_index, shortcut === 'paste' || shortcut === 'paste-plain-text')
          return this.context.axClipboard.perform(shortcut, tabId, focused)
        }
        const focused = await this.prepareFocus(tabId, action.element_index, false)
        return this.context.keyboard.dispatchKeys(this.context.cdp, focused.target, normalized,
          focused.inputTargetToken == null ? {} : { inputTargetToken: focused.inputTargetToken })
      }
      case 'scroll': {
        const target = typeof action.target === 'number' ? await this.hitTest.pointForElement(tabId, action.target) : await this.viewportPoint(tabId, action.target)
        const horizontal = ['left', 'l', 'right', 'r'].includes(action.direction)
        const distance = Math.max(horizontal ? target.width : target.height, 100) * (action.pages ?? 1)
        const delta = ['left', 'l', 'up', 'u'].includes(action.direction) ? -distance : distance
        await this.context.cua.dispatchMouseMove(tabId, target.point, 0)
        return this.context.cdp.call(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: target.point.x, y: target.point.y, deltaX: horizontal ? delta : 0, deltaY: horizontal ? 0 : delta })
      }
      case 'select_text': return this.hitTest.evaluateNode(
        this.context.ax.targetForElement(tabId, action.element_index), selectAxTextPage,
        { prefix: action.prefix, selectionType: action.selection_type ?? 'text', suffix: action.suffix, text: action.text })
      case 'set_value': {
        const node = this.context.ax.targetForElement(tabId, action.element_index)
        if (node.isValueSettable === false) throw Error(`Accessibility element ${action.element_index} has no settable value`)
        const first = await this.hitTest.evaluateNode(node, setAxValuePage, { value: action.value })
        if (first === 'needs-click') {
          await this.hitTest.click(tabId, action.element_index, { clickCount: 1 })
          if (await this.hitTest.evaluateNode(node, setAxValuePage, { value: action.value }) !== 'done')
            throw Error('Tab did not become selected')
        }
        return
      }
      default: throw Error(`Unsupported accessibility action: ${action}`)
    }
  }
}
