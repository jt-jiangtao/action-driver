interface Parsed {
  parts: { name: string; body: unknown }[]
  capture?: number
}
interface State {
  matches: boolean
  received?: string
}
interface Injected {
  querySelectorAll(parsed: Parsed, root: Node): Element[]
  checkDeprecatedSelectorUsage(parsed: Parsed, matches: Element[]): unknown
  strictModeViolationError(parsed: Parsed, matches: Element[]): Error
  elementState(element: Element, state: string): State
}
interface Point {
  x: number
  y: number
}
interface FrameScope {
  element: Element
  injected: Injected
}
/** Self-contained same-origin selector/geometry helpers for injected execution. */
function scopeHelpers() {
  function querySelectorStrictWithVisibleFallback(
    injected: Injected,
    parsed: Parsed,
    root: Node,
    strict = false
  ) {
    const matches = injected.querySelectorAll(parsed, root)
    if (matches.length === 0) {
      injected.checkDeprecatedSelectorUsage(parsed, matches)
      return null
    }
    if (matches.length === 1) {
      injected.checkDeprecatedSelectorUsage(parsed, matches)
      return matches[0]!
    }
    if (strict) throw injected.strictModeViolationError(parsed, matches)
    const visible = matches.filter((element) => !!injected.elementState(element, 'visible').matches)
    if (visible.length === 1) return visible[0]!
    throw injected.strictModeViolationError(parsed, matches)
  }
  function injectedForWindow(root: Injected, target: Window | null | undefined) {
    if (!target) throw Error('Frame window is not available')
    const window = target as Window & { __codexPlaywrightInjected?: Injected }
    if (window.__codexPlaywrightInjected) return window.__codexPlaywrightInjected
    const Constructor = root.constructor as unknown as new (
      window: Window,
      options: Record<string, unknown>
    ) => Injected
    window.__codexPlaywrightInjected = new Constructor(target, {
      isUnderTest: false,
      sdkLanguage: 'javascript',
      testIdAttributeName: 'data-testid',
      stableRafCount: 1,
      browserName: 'chromium',
      customEngines: []
    })
    return window.__codexPlaywrightInjected
  }
  function sliceParsedSelector(parsed: Parsed, start: number, end: number) {
    const result = { ...parsed, parts: parsed.parts.slice(start, end) }
    if (parsed.capture === undefined) delete result.capture
    else if (parsed.capture >= start && parsed.capture < end)
      result.capture = parsed.capture - start
    else delete result.capture
    return result
  }
  function frameContentSize(frame: Element) {
    const rect = frame.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0)
      throw Error('Frame does not have an actionable bounding box')
    const width = Number(frame.clientWidth) || rect.width,
      height = Number(frame.clientHeight) || rect.height
    if (width <= 0 || height <= 0) throw Error('Frame does not have an actionable bounding box')
    return { height, width }
  }
  function frameContentGeometry(frame: Element) {
    const rect = frame.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0)
      throw Error('Frame does not have an actionable bounding box')
    const offsetWidth = Number((frame as HTMLElement).offsetWidth) || rect.width,
      offsetHeight = Number((frame as HTMLElement).offsetHeight) || rect.height,
      width = Number(frame.clientWidth),
      height = Number(frame.clientHeight)
    if (offsetWidth <= 0 || offsetHeight <= 0 || width <= 0 || height <= 0)
      throw Error('Frame does not have an actionable bounding box')
    const scaleX = rect.width / offsetWidth,
      scaleY = rect.height / offsetHeight
    return {
      left: rect.left + (Number(frame.clientLeft) || 0) * scaleX,
      scaleX,
      scaleY,
      top: rect.top + (Number(frame.clientTop) || 0) * scaleY
    }
  }
  function pointThroughFrameElement(point: Point, frame: Element) {
    const geometry = frameContentGeometry(frame)
    return {
      x: geometry.left + point.x * geometry.scaleX,
      y: geometry.top + point.y * geometry.scaleY
    }
  }
  function prepareFrameChainForPointerAction(
    chain: FrameScope[],
    point: Point,
    alignment?: ScrollIntoViewOptions
  ) {
    let current = point
    const block = alignment?.block ?? 'center',
      inline = alignment?.inline ?? 'nearest'
    for (const scope of chain.slice().reverse()) {
      scope.element.scrollIntoView({ block, inline, behavior: 'instant' })
      const state = scope.injected.elementState(scope.element, 'visible')
      if (state.received === 'error:notconnected') throw Error('Frame is not connected')
      if (!state.matches) throw Error('Frame is not visible')
      current = pointThroughFrameElement(current, scope.element)
    }
    return current
  }
  function selectorScopeFor(initial: Injected, parsed: Parsed, strict = false) {
    let root: Node = document,
      injected = initial,
      start = 0
    const chain: FrameScope[] = []
    for (;;) {
      const next = parsed.parts.findIndex(
        (part, index) =>
          index >= start && part.name === 'internal:control' && part.body === 'enter-frame'
      )
      if (next === -1)
        return {
          frameChain: chain,
          injected,
          prepareFrameChainForPointerAction: (point: Point, alignment?: ScrollIntoViewOptions) =>
            prepareFrameChainForPointerAction(chain, point, alignment),
          root,
          parsed: sliceParsedSelector(parsed, start, parsed.parts.length)
        }
      const element = querySelectorStrictWithVisibleFallback(
        injected,
        sliceParsedSelector(parsed, start, next),
        root,
        strict
      )
      if (!element) return null
      const tag = String(element.localName || element.tagName || '').toLowerCase()
      if (tag !== 'iframe' && tag !== 'frame')
        throw Error('internal:control=enter-frame must target a frame element')
      let window: Window | null, document: Document | null | undefined
      const unavailable =
        'Cross-origin or out-of-process iframes are not supported by this runtime selector path'
      try {
        window = (element as HTMLIFrameElement).contentWindow
        document = (element as HTMLIFrameElement).contentDocument || window?.document
      } catch {
        throw Error(unavailable)
      }
      if (!window || !document) throw Error(unavailable)
      chain.push({ element, injected })
      root = document
      injected = injectedForWindow(initial, window)
      start = next + 1
    }
  }
  return {
    querySelectorStrictWithVisibleFallback,
    injectedForWindow,
    sliceParsedSelector,
    frameContentSize,
    frameContentGeometry,
    pointThroughFrameElement,
    prepareFrameChainForPointerAction,
    selectorScopeFor
  }
}
export function selectorScopeFunctions() {
  return `const {querySelectorStrictWithVisibleFallback,injectedForWindow,sliceParsedSelector,frameContentSize,frameContentGeometry,pointThroughFrameElement,prepareFrameChainForPointerAction,selectorScopeFor} = (${scopeHelpers.toString()})();`
}
