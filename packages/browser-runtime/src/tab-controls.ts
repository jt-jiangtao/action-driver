import { dispatch } from './protocol.js'
import type { ProtocolPayload } from './protocol.js'
import type { AgentTransport } from './transport.js'
import { decodeBase64 } from './tab-apis.js'
import { createDialog } from './dialogs.js'
/** Core Tab behavior used by the composed Tab client. */
export class TabControls {
  id: string
  #browserId: string
  #transport: AgentTransport | undefined
  constructor({
    browserId,
    transport,
    tabPayload = {}
  }: {
    browserId: string
    transport?: AgentTransport
    tabPayload?: { id?: string }
  }) {
    if (!tabPayload.id) throw new Error('Tab requires an id')
    this.id = tabPayload.id
    this.#browserId = browserId
    this.#transport = transport
  }
  #bound() {
    if (!this.#transport) throw new Error('Tab is not bound to a transport')
  }
  #send(type: string, payload: ProtocolPayload = {}, requireBound = true) {
    if (requireBound) this.#bound()
    return dispatch(this.#transport!, type, () => ({
      browser_id: this.#browserId,
      tab_id: this.id,
      ...(typeof payload === 'function' ? payload() : payload)
    })) as Promise<Record<string, unknown>>
  }

  async goto(url: string) {
    if (!url) throw new Error('tab.goto requires a url')
    this.#bound()
    if (!this.id) throw new Error('tab.goto requires a tab id')
    await this.#send('navigate_tab_url', { url })
  }
  async markHandoff() {
    await this.#send('mark_tab', { status: 'handoff' })
  }
  async markDeliverable() {
    await this.#send('mark_tab', { status: 'deliverable' })
  }
  async requestManualHandoff() {
    await this.#send('tab_manual_handoff_request', {}, false)
  }
  async back() {
    await this.#send('navigate_tab_back')
  }
  async forward() {
    await this.#send('navigate_tab_forward')
  }
  async reload() {
    await this.#send('navigate_tab_reload')
  }
  async close() {
    await this.#send('close_tab')
  }
  async screenshot(
    options: {
      fullPage?: boolean
      clip?: { x: number; y: number; width: number; height: number }
    } = {}
  ) {
    this.#bound()
    const payload: Record<string, unknown> = {
      browser_id: this.#browserId,
      tab_id: this.id,
      fullPage: options.fullPage
    }
    if (options.clip) {
      const { x, y, width, height } = options.clip
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof width !== 'number' ||
        typeof height !== 'number'
      )
        throw new Error('tab.screenshot clip requires x, y, width, and height')
      Object.assign(payload, { cropX: x, cropY: y, cropWidth: width, cropHeight: height })
    }
    return decodeBase64(
      ((await dispatch(this.#transport!, 'tab_screenshot', payload)) as Record<string, unknown>)
        .data as string
    )
  }
  async title() {
    return (await this.#send('get_tab')).title as string | undefined
  }
  async url() {
    return (await this.#send('get_tab')).url as string | undefined
  }
  async getJsDialog() {
    const dialog = (await this.#send('tab_get_js_dialog')).dialog as
      | { id: string; type: string }
      | null
      | undefined
    if (dialog != null)
      return createDialog(dialog.type, {
        browserId: this.#browserId,
        tabId: this.id,
        dialogId: dialog.id,
        transport: this.#transport!
      })
  }
}
