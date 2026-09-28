import { PlaywrightSelectors } from './service-playwright-selectors.js'
import type { SelectorCdp } from './service-playwright-selectors.js'
import type { CdpOptions } from './service-cdp-attachment.js'
import type { CdpTarget } from './service-cdp-execution.js'
import {
  retrySelector,
  selectorTelemetry,
  selectorNodeAttribute as attributeValue
} from './service-selector-policy.js'
type FrameLink = {
  frameId: string | null
  parentTarget: CdpTarget
  size: { width: number; height: number }
}
type NodeTarget = Parameters<PlaywrightSelectors['evaluateOnPlaywrightNode']>[0]
type Point = { x: number; y: number }
type Alignment = { block: string; inline: string }
type Boundary = { frame: FrameLink; ownerBackendNodeId: number; point: Point }
type ActionTarget = {
  frameBoundaries: Boundary[]
  inputPoint: Point
  inputTarget: CdpTarget
  point: Point
  target: CdpTarget
}
interface LocatorInput {
  tab_id: number
  selector: string
  timeout_ms?: number | undefined
  button?: string
  modifiers?: string[]
  force?: boolean
}
interface FocusOptions {
  requireEditable: boolean
  selectText?: boolean
}
interface PointerOptions {
  actionName: string
  dispatch: (target: ActionTarget) => Promise<unknown>
  force: boolean
  requiredStates: string[]
  timeoutMs: number
}
interface CuaPointer {
  clickPoint(action: {
    button: string
    clickCount: number
    inputPoint?: Point
    inputTarget?: CdpTarget
    loadTarget?: CdpTarget
    modifiers: number
    point: Point
    tabId: number
    timeoutMs: number
  }): Promise<unknown>
}
const center = { block: 'center', inline: 'nearest' }
let tokenCounter = 0
function inputToken(iab: boolean) {
  if (!iab) return undefined
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `iab-input-${Date.now()}-${++tokenCounter}-${Math.random().toString(36).slice(2)}`
}
function sequentialToken() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `press-sequentially-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
/** Self-contained: serialized into the page execution realm. */
async function focusPage(element: any, injected: any, arg: any) {
  for (
    let frame = element.ownerDocument.defaultView?.frameElement;
    frame != null;
    frame = frame.ownerDocument.defaultView?.frameElement
  )
    if (!injected.elementState(frame, 'visible').matches)
      throw Error('Ancestor frame is not visible')
  const states = ['visible', 'enabled']
  if (arg.requireEditable) states.push('editable')
  for (const state of states) {
    const result = injected.elementState(element, state)
    if (result.received === 'error:notconnected') throw Error('Element is not connected')
    if (!result.matches) throw Error('Element is not ' + state)
  }
  const target = arg.retargetInput ? injected.retarget(element, 'follow-label') : element
  if (target == null) throw Error('Element is not connected')
  element.scrollIntoView({ block: 'center', inline: 'nearest' })
  const focused = await injected.expect(target, { expression: 'to.be.focused', isNot: false }),
    result = arg.selectText
      ? injected.selectText(target)
      : focused.matches
        ? 'done'
        : injected.focusNode(target, false)
  if (result !== 'done') throw Error(String(result))
  if (!(await injected.expect(target, { expression: 'to.be.focused', isNot: false })).matches)
    throw Error('Element is not focused')
  if (arg.inputTargetToken != null)
    Object.defineProperty(target, '__codexIabInputTargetToken', {
      configurable: true,
      value: arg.inputTargetToken,
      writable: true
    })
}
/** Page action preparation and native pointer dispatch over resolved selector scopes. */
export class PlaywrightInput extends PlaywrightSelectors {
  constructor(
    cdp: SelectorCdp & { platform?: string },
    public cua: CuaPointer,
    span: ConstructorParameters<typeof PlaywrightSelectors>[1],
    timing: ConstructorParameters<typeof PlaywrightSelectors>[2],
    iab = false
  ) {
    super(cdp, span, timing, iab)
  }
  async focusLocator(params: LocatorInput, options: FocusOptions) {
    const token = inputToken(this.isIabBackend),
      { executionContextId, target } = await this.evaluateOnPlaywrightSelectorWithTarget(
        params.tab_id,
        params.selector,
        focusPage,
        {
          arg: {
            ...options,
            inputTargetToken: token,
            retargetInput: options.requireEditable || options.selectText === true
          },
          timeoutMs: params.timeout_ms
        }
      )
    return {
      executionContextId,
      target,
      inputTargetToken: token,
      blockClosedShadowInput: this.isIabBackend
    }
  }
  async focusNode(node: NodeTarget, options: FocusOptions & { timeoutMs: number }) {
    const token = inputToken(this.isIabBackend),
      startedAt = Date.now(),
      budget = {
        startedAt,
        timeoutMs: options.timeoutMs,
        deadlineMs: startedAt + options.timeoutMs
      }
    return {
      ...(await retrySelector(
        'accessibility element',
        () =>
          this.evaluateOnPlaywrightNode(node, focusPage, {
            ...budget,
            arg: { ...options, inputTargetToken: token, retargetInput: false }
          }),
        budget,
        this.commandTiming
      )),
      inputTargetToken: token,
      blockClosedShadowInput: this.isIabBackend
    }
  }
  async prepareLocatorFill(params: LocatorInput, value: string) {
    const token = inputToken(this.isIabBackend)
    return {
      ...(await this.evaluateOnPlaywrightSelectorWithTarget(
        params.tab_id,
        params.selector,
        (element: any, injected: any, arg: any) => {
          for (const state of arg.states) {
            const result = injected.elementState(element, state)
            if (result.received === 'error:notconnected') throw Error('Element is not connected')
            if (!result.matches) throw Error('Element is not ' + state)
          }
          element.scrollIntoView({ block: 'center', inline: 'nearest' })
          const result = injected.fill(element, arg.value)
          if (result === 'error:notconnected') throw Error('Element is not connected')
          if (result !== 'done' && result !== 'needsinput') throw Error(result)
          if (result === 'done') return result
          const target =
            typeof injected.retarget === 'function'
              ? injected.retarget(element, 'follow-label')
              : element
          if (target == null) throw Error('Element is not connected')
          if (arg.inputTargetToken != null)
            Object.defineProperty(target, '__codexIabInputTargetToken', {
              configurable: true,
              value: arg.inputTargetToken,
              writable: true
            })
          return result
        },
        {
          arg: { inputTargetToken: token, states: ['visible', 'enabled', 'editable'], value },
          timeoutMs: params.timeout_ms
        }
      )),
      inputTargetToken: token,
      blockClosedShadowInput: this.isIabBackend
    }
  }
  async prepareSequentialInput(params: LocatorInput, deadlineMs: number) {
    const targetToken = sequentialToken(),
      token = inputToken(this.isIabBackend)
    return {
      ...(await this.evaluateOnPlaywrightSelectorWithTarget(
        params.tab_id,
        params.selector,
        (element: any, injected: any, arg: any) => {
          for (const state of arg.states) {
            const result = injected.elementState(element, state)
            if (result.received === 'error:notconnected') throw Error('Element is not connected')
            if (!result.matches) throw Error('Element is not ' + state)
          }
          element.scrollIntoView({ block: 'center', inline: 'nearest' })
          const target =
            typeof injected.retarget === 'function'
              ? injected.retarget(element, 'follow-label')
              : element
          if (target == null) throw Error('Element is not connected')
          if (!target.matches(':focus')) {
            const result = injected.focusNode(target, false)
            if (result !== 'done') throw Error(String(result))
          }
          Object.defineProperty(target, '__codexPressSequentiallyTargetToken', {
            configurable: true,
            value: arg.targetToken
          })
          if (arg.inputTargetToken != null)
            Object.defineProperty(target, '__codexIabInputTargetToken', {
              configurable: true,
              value: arg.inputTargetToken,
              writable: true
            })
          return true
        },
        {
          arg: { inputTargetToken: token, states: ['visible', 'enabled', 'editable'], targetToken },
          deadlineMs,
          timeoutMs: params.timeout_ms
        }
      )),
      inputTargetToken: token,
      targetToken,
      blockClosedShadowInput: this.isIabBackend
    }
  }
  async readCheckedState(params: LocatorInput) {
    return await this.evaluateOnPlaywrightSelector(
      params.tab_id,
      params.selector,
      (element: any, injected: any) => {
        const state = injected.elementState(element, 'checked')
        if (state.received === 'error:notconnected') throw Error('Element is not connected')
        return { checked: !!state.matches, isRadio: !!state.isRadio }
      },
      { timeoutMs: params.timeout_ms }
    )
  }
  async readElementState(params: LocatorInput, stateName: string) {
    return await this.evaluateOnPlaywrightSelectorAll(
      params.tab_id,
      params.selector,
      (elements: any[], injected: any, arg: any) => {
        const element = elements[0] ?? null
        if (!element) return false
        const state = injected.elementState(element, arg.stateName)
        return state.received === 'error:notconnected' ? false : !!state.matches
      },
      { arg: { stateName }, timeoutMs: params.timeout_ms }
    )
  }
  async clickLocator(params: LocatorInput, count: number) {
    const tabId = Number(params.tab_id)
    if (!Number.isInteger(tabId) || tabId <= 0) throw Error('Expected a positive integer')
    const timeoutMs = Math.min(
        Math.max(0, typeof params.timeout_ms === 'number' ? params.timeout_ms : 3000),
        3000
      ),
      force = params.force === true,
      button = params.button === 'right' || params.button === 'middle' ? params.button : 'left'
    let modifiers = 0
    for (const raw of params.modifiers ?? []) {
      const key =
        raw === 'ControlOrMeta'
          ? (this.cdp as { platform?: string }).platform === 'darwin'
            ? 'Meta'
            : 'Control'
          : raw
      modifiers |= ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 } as Record<string, number>)[key] ?? 0
    }
    await this.performPointerAction(params, {
      actionName: count === 1 ? 'click' : 'dblclick',
      force,
      requiredStates: force ? [] : ['visible', 'enabled'],
      timeoutMs,
      dispatch: (target) =>
        this.cua.clickPoint({
          button,
          clickCount: count,
          ...(target.target.sessionId != null || target.target.targetId != null
            ? {
                inputPoint: target.inputPoint,
                inputTarget: target.inputTarget,
                loadTarget: target.target
              }
            : {}),
          modifiers,
          point: target.point,
          tabId,
          timeoutMs
        })
    })
  }
  async performPointerAction(params: LocatorInput, options: PointerOptions) {
    let obstruction: string | null = null
    for (const alignment of options.force
      ? [center]
      : [center, { block: 'end', inline: 'end' }, { block: 'start', inline: 'start' }]) {
      const target = await this.resolvePointerActionTarget(params, {
        requiredStates: options.requiredStates,
        scrollAlignment: alignment
      })
      obstruction = options.force
        ? null
        : await this.obstructingFrameHitTarget(target, { timeoutMs: options.timeoutMs })
      if (obstruction == null) {
        await options.dispatch(target)
        return
      }
    }
    throw Error(
      `Element does not receive pointer events at the ${options.actionName} point; ${obstruction ?? 'another element'} intercepts the ${options.actionName}`
    )
  }
  async resolvePointerActionTarget(
    params: LocatorInput,
    options: { requiredStates: string[]; scrollAlignment?: Alignment }
  ) {
    const evaluated = await this.evaluateOnPlaywrightSelectorWithTarget(
      params.tab_id,
      params.selector,
      async (element: any, injected: any, arg: any, scope: any) => {
        const waitFrame = async () =>
          await new Promise<void>((resolve) => {
            const w = element.ownerDocument?.defaultView
            if (typeof w?.requestAnimationFrame === 'function') {
              const timer =
                typeof w.setTimeout === 'function'
                  ? w.setTimeout(() => {
                      w.cancelAnimationFrame?.(frame)
                      resolve()
                    }, 50)
                  : undefined
              const frame = w.requestAnimationFrame(() => {
                if (timer != null) w.clearTimeout(timer)
                resolve()
              })
              return
            }
            if (typeof w?.setTimeout === 'function') {
              w.setTimeout(resolve, 0)
              return
            }
            resolve()
          })
        for (const state of arg.requiredStates) {
          const result = injected.elementState(element, state)
          if (result.received === 'error:notconnected') throw Error('Element is not connected')
          if (!result.matches) throw Error('Element is not ' + state)
        }
        element.scrollIntoView({
          block: arg.scrollAlignment.block,
          inline: arg.scrollAlignment.inline,
          behavior: 'instant'
        })
        let rect = element.getBoundingClientRect(),
          stable = 0
        for (let attempt = 0; attempt < 10; attempt++) {
          await waitFrame()
          const next = element.getBoundingClientRect()
          const same =
            rect.left === next.left &&
            rect.top === next.top &&
            rect.width === next.width &&
            rect.height === next.height
          stable = same ? stable + 1 : 0
          rect = next
          if (stable >= 2) break
        }
        for (const state of arg.requiredStates) {
          const result = injected.elementState(element, state)
          if (result.received === 'error:notconnected') throw Error('Element is not connected')
          if (!result.matches) throw Error('Element is not ' + state)
        }
        if (!rect || rect.width <= 0 || rect.height <= 0)
          throw Error('Element does not have a clickable bounding box')
        return scope.prepareFrameChainForPointerAction(
          {
            x: Math.max(0, rect.left + rect.width / 2),
            y: Math.max(0, rect.top + rect.height / 2)
          },
          arg.scrollAlignment
        )
      },
      {
        arg: {
          requiredStates: options.requiredStates,
          scrollAlignment: options.scrollAlignment ?? center
        },
        timeoutMs: params.timeout_ms
      }
    )
    const transformed = await this.currentTopLevelPointForAction(
      evaluated.result as Point,
      evaluated.oopifFrameChain,
      { timeoutMs: params.timeout_ms }
    )
    return {
      frameBoundaries: transformed.frameBoundaries,
      inputPoint: evaluated.result as Point,
      inputTarget: evaluated.target,
      point: transformed.point,
      target: evaluated.target
    }
  }
  async currentTopLevelPointForAction(point: Point, chain: FrameLink[], options: CdpOptions = {}) {
    let current = point
    const frameBoundaries: Boundary[] = []
    for (const frame of (chain ?? []).slice().reverse()) {
      const parent = await this.currentPointInParentFrame(frame, current, options)
      current = parent.point
      frameBoundaries.push({ frame, ownerBackendNodeId: parent.backendNodeId, point: current })
    }
    return { frameBoundaries, point: current }
  }
  async currentPointInParentFrame(frame: FrameLink, point: Point, options: CdpOptions = {}) {
    if (frame.frameId == null) throw Error('Cannot recompute OOPIF frame offset without a frame id')
    const { backendNodeId } = await this.callCdpTarget(
      frame.parentTarget,
      'DOM.getFrameOwner',
      { frameId: frame.frameId },
      options
    )
    const quad = this.isIabBackend
      ? (
          await this.callCdpTarget(
            frame.parentTarget,
            'DOM.getBoxModel',
            { backendNodeId },
            options
          )
        ).model.content
      : (
          await this.callCdpTarget(
            frame.parentTarget,
            'DOM.getContentQuads',
            { backendNodeId },
            options
          )
        ).quads[0]
    if (quad == null || quad.length < 8) throw Error('Frame owner does not have content quads')
    const x = point.x / frame.size.width,
      y = point.y / frame.size.height
    return {
      backendNodeId,
      point: {
        x:
          (quad[0] ?? 0) +
          x * ((quad[2] ?? 0) - (quad[0] ?? 0)) +
          y * ((quad[6] ?? 0) - (quad[0] ?? 0)),
        y:
          (quad[1] ?? 0) +
          x * ((quad[3] ?? 0) - (quad[1] ?? 0)) +
          y * ((quad[7] ?? 0) - (quad[1] ?? 0))
      }
    }
  }
  async obstructingFrameHitTarget(
    target: { frameBoundaries: Boundary[] },
    options: CdpOptions = {}
  ) {
    for (const boundary of target.frameBoundaries.slice().reverse()) {
      const result = await this.obstructingFrameBoundaryHitTarget(boundary, options)
      if (result != null) return result
    }
    return null
  }
  async obstructingFrameBoundaryHitTarget(boundary: Boundary, options: CdpOptions = {}) {
    try {
      const hit = await this.callCdpTarget(
        boundary.frame.parentTarget,
        'DOM.getNodeForLocation',
        {
          x: Math.round(boundary.point.x),
          y: Math.round(boundary.point.y),
          includeUserAgentShadowDOM: true
        },
        {
          timeoutMs: options.timeoutMs,
          telemetryAttrs: selectorTelemetry({
            operation: this.performanceSpan.currentPlaywrightOperation('locator'),
            phase: 'hit_target_check'
          })
        }
      )
      return hit.backendNodeId === boundary.ownerBackendNodeId ||
        hit.frameId === boundary.frame.frameId
        ? null
        : await this.describeBackendNodeForHitTarget(
            boundary.frame.parentTarget,
            hit.backendNodeId,
            options
          )
    } catch {
      return null
    }
  }
  async describeBackendNodeForHitTarget(
    target: CdpTarget,
    backendNodeId: number,
    options: CdpOptions = {}
  ) {
    try {
      const { node } = await this.callCdpTarget(
          target,
          'DOM.describeNode',
          { backendNodeId },
          options
        ),
        tag = node.localName || node.nodeName?.toLowerCase() || 'unknown',
        attrs = Array.isArray(node.attributes) ? node.attributes : [],
        id = attributeValue(attrs, 'id'),
        classes = attributeValue(attrs, 'class')
      return `<${tag}${id ? '#' + id : ''}${classes ? '.' + classes.trim().split(/\s+/).slice(0, 3).join('.') : ''}>`
    } catch {
      return 'another element'
    }
  }
}
