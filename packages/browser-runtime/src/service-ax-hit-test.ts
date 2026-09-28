const boundsForQuad = (quad: number[] | undefined) => {
  if (!quad || quad.length < 8) return undefined
  const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]]
  if (xs.some(value => value == null) || ys.some(value => value == null)) return undefined
  return { left: Math.min(...xs as number[]), right: Math.max(...xs as number[]), top: Math.min(...ys as number[]), bottom: Math.max(...ys as number[]) }
}
/** Runs in the page realm to get a hit point for an AX backend node. */
function hitTestPage(this: any) {
  const element = this instanceof Element ? this : this.parentElement
  if (element == null) throw Error('Cannot hit-test a detached accessibility element')
  const rect = element.getClientRects()[0] ?? element.getBoundingClientRect()
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  const viewport = element.ownerDocument.defaultView
  if (viewport == null) throw Error('Cannot hit-test an accessibility element without a viewport')
  const visual = viewport.visualViewport
  const left = Math.max(rect.left, visual?.offsetLeft ?? 0)
  const right = Math.min(rect.right, (visual?.offsetLeft ?? 0) + (visual?.width ?? viewport.innerWidth))
  const top = Math.max(rect.top, visual?.offsetTop ?? 0)
  const bottom = Math.min(rect.bottom, (visual?.offsetTop ?? 0) + (visual?.height ?? viewport.innerHeight))
  const clipped = right > left && bottom > top ? { x: (left + right) / 2, y: (top + bottom) / 2 } : point
  const hit = element.ownerDocument.elementFromPoint(clipped.x, clipped.y)
  return { point: clipped, hitsTarget: hit === element || element.contains(hit), hitTag: hit?.tagName ?? null,
    fallbackPoint: null, viewportSize: { width: viewport.innerWidth, height: viewport.innerHeight } }
}
function scrollCenterPage(this: any) {
  const element = this instanceof Element ? this : this.parentElement
  if (!element) throw Error('Cannot scroll a detached accessibility element')
  Element.prototype.scrollIntoView.call(element, { behavior: 'instant', block: 'center', inline: 'center' })
}
async function evaluateNode(context: any, node: any, fn: Function, argument?: unknown) {
  const { object } = await context.cdp.callTarget(node.target, 'DOM.resolveNode', { backendNodeId: node.backendNodeId })
  const objectId = object.objectId
  if (objectId == null) throw Error(`Could not resolve accessibility element ${node.id}`)
  try {
    const result = await context.cdp.callTarget(node.target, 'Runtime.callFunctionOn', {
      arguments: [{ value: argument }],
      functionDeclaration: `function (argument) { const __name = (target) => target; return (${fn.toString()}).call(this, argument); }`,
      objectId, returnByValue: true, userGesture: true
    })
    if (result.exceptionDetails) throw Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text ?? 'Accessibility action failed'))
    return result.result.value
  } finally { await context.cdp.callTarget(node.target, 'Runtime.releaseObject', { objectId }).catch(() => {}) }
}
export class AxHitTest {
  constructor(private readonly context: any) {}
  evaluateNode(node: any, fn: Function, argument?: unknown) { return evaluateNode(this.context, node, fn, argument) }
  async pointForElement(tabId: number, index: number) {
    return this.pointForNode(tabId, this.context.ax.targetForElement(tabId, index))
  }
  private async pointForNode(tabId: number, node: any) {
    const check = async () => {
      const { quads } = await this.context.cdp.callTarget(node.target, 'DOM.getContentQuads', { backendNodeId: node.backendNodeId })
      const quad = boundsForQuad(quads[0])
      return quad ? { quad, hit: await evaluateNode(this.context, node, hitTestPage) } : undefined
    }
    let found = await check()
    if (!found || !found.hit.hitsTarget) {
      await this.context.cdp.callTarget(node.target, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendNodeId })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message.includes('Node does not have a layout object'))
            throw Error(`Element ${node.id} couldn't be clicked. Try another element.`, { cause: error })
          throw error
        })
      found = await check()
    }
    if (!found) throw Error(`Element ${node.id} couldn't be clicked. Try another element.`)
    if (!found.hit.hitsTarget) {
      await evaluateNode(this.context, node, scrollCenterPage)
      const until = Date.now() + 500
      while (Date.now() < until) {
        found = await check()
        if (found?.hit.hitsTarget) break
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    if (!found?.hit.hitsTarget) throw Error(`Accessibility element ${node.id} is covered by ${found?.hit.hitTag ?? 'another element'} or otherwise not hittable`)
    const { quad, hit } = found
    const frame = this.context.ax.frameForId(tabId, node.frameId)
    if (!frame) throw Error(`Accessibility frame ${node.frameId} is unavailable`)
    // The input point remains in the owning target's viewport. Parent-frame mapping is handled below.
    let outer = hit.point, current = frame
    while (current.parentFrameId != null) {
      const parent = this.context.ax.frameForId(tabId, current.parentFrameId)
      if (!parent) throw Error(`Accessibility frame ${current.parentFrameId} is unavailable`)
      if (current.ownerBackendNodeId == null) throw Error(`Accessibility frame ${current.frameId} has no owner`)
      const owner = await this.context.cdp.callTarget(parent.target, 'DOM.getContentQuads', { backendNodeId: current.ownerBackendNodeId })
      const bounds = boundsForQuad(owner.quads[0])
      if (!bounds) throw Error(`Accessibility frame ${current.frameId} has no content bounds`)
      outer = { x: bounds.left + outer.x, y: bounds.top + outer.y }
      current = parent
    }
    return { height: quad.bottom - quad.top, width: quad.right - quad.left, inputPoint: hit.point, point: outer, target: node.target }
  }
  async click(tabId: number, index: number, options: { button?: string; clickCount: number }) {
    const button = options.button === 'right' || options.button === 'r' ? 'right' : options.button === 'middle' || options.button === 'm' ? 'middle' : 'left'
    const point = await this.pointForElement(tabId, index)
    await this.context.cua.clickPoint({ button, clickCount: options.clickCount,
      deferPageLoadWait: (load: Promise<unknown>) => this.context.ax.trackDeferredPageLoad(tabId, load),
      inputPoint: point.inputPoint, inputTarget: point.target, loadTarget: point.target,
      modifiers: 0, point: point.point, tabId })
  }
}
