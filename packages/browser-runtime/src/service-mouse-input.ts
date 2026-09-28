import { checkMouseInput } from './service-input-guard.js'
import type { InputPoint, InputGuardCdp } from './service-input-guard.js'
import type { CdpTarget } from './service-cdp-execution.js'
import type { CdpOptions } from './service-cdp-attachment.js'
interface MouseCdp extends InputGuardCdp {
  call(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    options?: CdpOptions
  ): Promise<any>
  waitForPageLoadEvent(
    target: number | CdpTarget,
    options: { timeoutMs: number; rejectSubframeNavigationBlocked?: boolean }
  ): Promise<unknown>
}
interface MouseUi {
  moveMouse(
    id: number,
    x: number,
    y: number,
    options?: { waitForArrival?: boolean }
  ): Promise<unknown>
}
type Button = 'left' | 'middle' | 'right'
interface MouseAction {
  button: Button
  clickCount: number
  deadlineMs?: number | undefined
  modifiers: number
  point: InputPoint
  target: CdpTarget
  topLevelPoint?: InputPoint
}
const id = (input: number | string) => {
  const number = Number(input)
  if (!Number.isInteger(number) || number <= 0) throw Error('Expected a positive integer')
  return number
}
const timeout = (value: number | undefined) =>
  Math.min(Math.max(0, typeof value === 'number' ? value : 3000), 3000)
const buttons = (button: Button) => (button === 'right' ? 2 : button === 'middle' ? 4 : 1)
function center(quad: number[] | undefined) {
  if (quad == null || quad.length < 8) return null
  return {
    x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4,
    y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4
  }
}
export class MouseInput {
  constructor(
    public cdp: MouseCdp,
    public ui: MouseUi,
    public scrollMethod: 'mouseWheel' | 'synthesizeScrollGesture' = 'synthesizeScrollGesture',
    public blockClosedShadowInput = false
  ) {}
  mouseInputPoint(point: InputPoint) {
    return this.blockClosedShadowInput ? { x: Math.round(point.x), y: Math.round(point.y) } : point
  }
  async dispatchMouseMove(tabId: number, point: InputPoint, modifiers: number) {
    await this.ui.moveMouse(tabId, point.x, point.y)
    await this.cdp.call(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
      buttons: 0,
      modifiers
    })
  }
  async getBackendNodeViewportPoint(tabId: number, node: number) {
    await this.cdp.call(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: node })
    try {
      const { quads } = await this.cdp.call(tabId, 'DOM.getContentQuads', { backendNodeId: node }),
        point = center(quads[0])
      if (point !== null) return point
    } catch {}
    const { model } = await this.cdp.call(tabId, 'DOM.getBoxModel', { backendNodeId: node }),
      point = center(model.border)
    if (point === null) throw Error(`Missing DOM geometry for backend node ${node}`)
    return point
  }
  async dispatchCdpMouseMove(action: {
    target: CdpTarget
    point: InputPoint
    modifiers: number
    deadlineMs?: number | undefined
  }) {
    await this.cdp.callTarget(
      action.target,
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        x: action.point.x,
        y: action.point.y,
        button: 'none',
        buttons: 0,
        modifiers: action.modifiers
      },
      { deadlineMs: action.deadlineMs }
    )
  }
  async dispatchMouseDown(action: MouseAction) {
    if (this.blockClosedShadowInput)
      await checkMouseInput(
        this.cdp,
        action.target,
        action.point,
        { deadlineMs: action.deadlineMs },
        action.topLevelPoint
      )
    await this.cdp.callTarget(
      action.target,
      'Input.dispatchMouseEvent',
      {
        type: 'mousePressed',
        x: action.point.x,
        y: action.point.y,
        button: action.button,
        buttons: buttons(action.button),
        clickCount: action.clickCount,
        modifiers: action.modifiers
      },
      { deadlineMs: action.deadlineMs }
    )
  }
  async dispatchMouseUp(action: MouseAction) {
    await this.dispatchCdpMouseRelease(action)
  }
  async dispatchCdpMouseRelease(action: MouseAction) {
    await this.cdp.callTarget(
      action.target,
      'Input.dispatchMouseEvent',
      {
        type: 'mouseReleased',
        x: action.point.x,
        y: action.point.y,
        button: action.button,
        buttons: 0,
        clickCount: action.clickCount,
        modifiers: action.modifiers
      },
      { deadlineMs: action.deadlineMs }
    )
  }
  async dispatchPressedMouseMove(
    tabId: number,
    point: InputPoint,
    button: Button,
    modifiers: number
  ) {
    await this.ui.moveMouse(tabId, point.x, point.y, { waitForArrival: false })
    await this.cdp.call(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button,
      buttons: buttons(button),
      modifiers
    })
  }
  async dragPath(action: { tabId: number; path: InputPoint[]; modifiers: number }) {
    const tabId = id(action.tabId),
      [first, ...remaining] = action.path.map((point) => this.mouseInputPoint(point))
    if (first === undefined) throw Error('cua_drag requires a non-empty path')
    const button = 'left'
    await this.dispatchMouseMove(tabId, first, action.modifiers)
    await this.dispatchMouseDown({
      button,
      clickCount: 1,
      modifiers: action.modifiers,
      point: first,
      target: { tabId }
    })
    let last = first,
      released = false
    try {
      for (const point of remaining) {
        if (this.blockClosedShadowInput) await checkMouseInput(this.cdp, { tabId }, point, {})
        last = point
        await this.dispatchPressedMouseMove(tabId, point, button, action.modifiers)
      }
      if (this.blockClosedShadowInput) await checkMouseInput(this.cdp, { tabId }, last, {})
      released = true
      await this.dispatchMouseUp({
        button,
        clickCount: 1,
        modifiers: action.modifiers,
        point: last,
        target: { tabId }
      })
    } finally {
      if (!released) {
        if (this.blockClosedShadowInput)
          try {
            await checkMouseInput(this.cdp, { tabId }, last, {})
          } catch {
            last = { x: -1, y: -1 }
          }
        await this.dispatchMouseUp({
          button,
          clickCount: 1,
          modifiers: action.modifiers,
          point: last,
          target: { tabId }
        }).catch(() => {})
      }
    }
  }
  async scrollPoint(action: {
    tabId: number
    point: InputPoint
    modifiers: number
    scrollX: number
    scrollY: number
  }) {
    const tabId = id(action.tabId)
    await this.dispatchMouseMove(tabId, action.point, action.modifiers)
    if (this.scrollMethod === 'mouseWheel') {
      await this.cdp.call(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: action.point.x,
        y: action.point.y,
        deltaX: action.scrollX,
        deltaY: action.scrollY,
        modifiers: action.modifiers
      })
      return
    }
    await this.cdp.call(tabId, 'Input.synthesizeScrollGesture', {
      x: action.point.x,
      y: action.point.y,
      xDistance: action.scrollX === 0 ? 0 : -action.scrollX,
      yDistance: action.scrollY === 0 ? 0 : -action.scrollY,
      gestureSourceType: 'mouse',
      preventFling: true,
      speed: 8000
    })
  }
  async clickPoint(action: {
    tabId: number
    point: InputPoint
    inputPoint?: InputPoint
    inputTarget?: CdpTarget
    loadTarget?: CdpTarget
    clickCount: number
    button?: Button
    modifiers: number
    timeoutMs?: number
    deferPageLoadWait?: (wait: Promise<void>) => void
  }) {
    const tabId = id(action.tabId),
      duration = timeout(action.timeoutMs),
      deadlineMs = Date.now() + duration,
      button = action.button ?? 'left',
      point = this.mouseInputPoint(action.inputPoint ?? action.point),
      target = action.inputTarget ?? { tabId },
      load =
        action.loadTarget == null ||
        (action.loadTarget.sessionId == null && action.loadTarget.targetId == null)
          ? this.cdp.waitForPageLoadEvent(tabId, { timeoutMs: duration })
          : Promise.all([
              this.cdp.waitForPageLoadEvent(action.loadTarget, { timeoutMs: duration }),
              this.cdp.waitForPageLoadEvent(tabId, {
                rejectSubframeNavigationBlocked: true,
                timeoutMs: duration
              })
            ]),
      settled = load.catch(() => {})
    try {
      await this.ui.moveMouse(tabId, action.point.x, action.point.y)
      await this.dispatchCdpMouseMove({ deadlineMs, modifiers: action.modifiers, point, target })
      for (let clickCount = 1; clickCount <= action.clickCount; clickCount++) {
        await this.dispatchMouseDown({
          button,
          clickCount,
          deadlineMs,
          modifiers: action.modifiers,
          point,
          target,
          topLevelPoint: this.mouseInputPoint(action.point)
        })
        await this.dispatchMouseUp({
          button,
          clickCount,
          deadlineMs,
          modifiers: action.modifiers,
          point,
          target
        })
      }
    } catch (error) {
      await settled
      throw error
    }
    if (action.deferPageLoadWait != null) {
      action.deferPageLoadWait(load.then(() => {}))
      return
    }
    await load
  }
}
