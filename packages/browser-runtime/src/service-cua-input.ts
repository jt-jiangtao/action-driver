import { MouseInput } from './service-mouse-input.js'
import { dispatchKeys } from './service-keyboard-input.js'
import { DomSnapshotState } from './service-dom-state.js'
import type { BrowserCdp } from './service-cdp.js'
/** Concrete CUA input shares snapshot ownership with the DOM snapshot producer. */
export class CuaInput extends MouseInput {
  declare cdp: BrowserCdp
  constructor(
    cdp: BrowserCdp,
    ui: ConstructorParameters<typeof MouseInput>[1],
    scrollMethod: 'mouseWheel' | 'synthesizeScrollGesture' = 'synthesizeScrollGesture',
    blockClosedShadowInput = false,
    public domState = new DomSnapshotState()
  ) {
    super(cdp, ui, scrollMethod, blockClosedShadowInput)
    domState.registerCleanup(cdp)
  }
  async dispatchKeyPress(action: { commandName: string; tabId: number | string; keys: string[] }) {
    if (!Array.isArray(action.keys) || action.keys.length === 0)
      throw Error(`${action.commandName} requires a non-empty keys array`)
    const tabId = Number(action.tabId)
    if (!Number.isInteger(tabId) || tabId <= 0) throw Error('Expected a positive integer')
    await dispatchKeys(this.cdp, tabId, action.keys, {
      blockClosedShadowInput: this.blockClosedShadowInput
    })
  }
  async clickDomCuaNode(action: {
    tabId: number
    nodeId: string
    clickCount: number
    timeoutMs?: number
  }) {
    const resolved = await this.domState.point(
        action.tabId,
        this.cdp,
        action.nodeId,
        this.blockClosedShadowInput
      ),
      nested = resolved.target.sessionId != null || resolved.target.targetId != null
    await this.clickPoint({
      clickCount: action.clickCount,
      ...(nested
        ? {
            inputPoint: resolved.inputPoint,
            inputTarget: resolved.target,
            loadTarget: resolved.target
          }
        : {}),
      modifiers: 0,
      point: resolved.point,
      tabId: action.tabId,
      ...(action.timeoutMs == null
        ? {}
        : { timeoutMs: Math.min(Math.max(0, action.timeoutMs), 3000) })
    })
  }
  async scrollDomCuaNode(action: {
    tabId: number
    nodeId: string
    scrollX: number
    scrollY: number
  }) {
    const { point } = await this.domState.point(
      action.tabId,
      this.cdp,
      action.nodeId,
      this.blockClosedShadowInput
    )
    await this.scrollPoint({
      modifiers: 0,
      point,
      scrollX: action.scrollX,
      scrollY: action.scrollY,
      tabId: action.tabId
    })
  }
}
