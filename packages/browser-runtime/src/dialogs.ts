import type { AgentTransport } from './transport.js'
import { send } from './locator.js'
interface DialogOptions {
  browserId: string
  tabId: string
  dialogId: string
  transport: AgentTransport
}
class Dialog {
  browserId: string
  dialogId: string
  tabId: string
  transport: AgentTransport
  type: string
  constructor(options: DialogOptions & { type: string }) {
    this.browserId = options.browserId
    this.dialogId = options.dialogId
    this.tabId = options.tabId
    this.transport = options.transport
    this.type = options.type
  }
  async dismiss() {
    await send(this, 'tab_handle_js_dialog', () => ({
      action: 'dismiss',
      dialog_id: this.dialogId
    }))
  }
}
export class AlertDialog extends Dialog {
  constructor(options: DialogOptions) {
    super({ ...options, type: 'alert' })
  }
}
export class BeforeUnloadDialog extends Dialog {
  constructor(options: DialogOptions) {
    super({ ...options, type: 'beforeunload' })
  }
}
export class ConfirmDialog extends Dialog {
  constructor(options: DialogOptions) {
    super({ ...options, type: 'confirm' })
  }
  async accept() {
    await send(this, 'tab_handle_js_dialog', () => ({ action: 'accept', dialog_id: this.dialogId }))
  }
}
export class PromptDialog extends Dialog {
  constructor(options: DialogOptions) {
    super({ ...options, type: 'prompt' })
  }
  async accept(text: string) {
    if (typeof text !== 'string') throw new Error('prompt.accept requires text')
    await send(this, 'tab_handle_js_dialog', () => ({
      action: 'accept',
      dialog_id: this.dialogId,
      prompt_text: text
    }))
  }
}
export function createDialog(type: string, options: DialogOptions) {
  switch (type) {
    case 'alert':
      return new AlertDialog(options)
    case 'beforeunload':
      return new BeforeUnloadDialog(options)
    case 'confirm':
      return new ConfirmDialog(options)
    case 'prompt':
      return new PromptDialog(options)
  }
}
