import type { CdpTarget } from './service-cdp-execution.js'
import type { InputPoint } from './service-input-guard.js'
export interface ViewportClip {
  left: number
  top: number
  right: number
  bottom: number
}
export interface DomFrame {
  frameId: string
  loaderId?: string
  target: CdpTarget
  parentFrameId?: string
  size?: { width: number; height: number }
}
interface DomNode {
  frameId: string
  loaderId: string | undefined
  localRef: string
  target: CdpTarget
  viewportClip: ViewportClip
}
interface DomCdp {
  callTarget(
    target: CdpTarget,
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number | undefined }
  ): Promise<any>
  addTabCleanupHandler?(callback: (id: number) => void): unknown
}
interface Snapshot {
  mainFrameKey: string
  framesById: Map<string, DomFrame>
  nextPublicId: number
  nodeByPublicId: Map<string, DomNode>
  publicIdByFrameLocalRef: Map<string, string>
}
const targetKey = (target: CdpTarget) =>
  `${target.tabId}:${target.sessionId ?? ''}:${target.targetId ?? ''}`
const sameTarget = (a: CdpTarget, b: CdpTarget) => targetKey(a) === targetKey(b)
function visiblePoint(ref: string, clip: ViewportClip) {
  const state = (globalThis as any).__browserUseVisibleDomState
  const node = state?.refToElement.get(ref)
  if (!node?.isConnected) return null
  node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const center = (rect: DOMRect) => {
    if (rect.width <= 0 || rect.height <= 0) return null
    const left = Math.max(rect.left, clip.left),
      right = Math.min(rect.right, clip.right),
      top = Math.max(rect.top, clip.top),
      bottom = Math.min(rect.bottom, clip.bottom)
    return right > left && bottom > top ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null
  }
  for (const rect of node.getClientRects()) {
    const point = center(rect)
    if (point !== null) return point
  }
  return center(node.getBoundingClientRect())
}
export class DomSnapshotState {
  private snapshots = new Map<number, Snapshot>()
  private contexts = new Map<string, { executionContextId: number }>()
  private cleanupRegistered = new WeakSet<DomCdp>()
  registerCleanup(cdp: DomCdp) {
    if (this.cleanupRegistered.has(cdp)) return
    this.cleanupRegistered.add(cdp)
    cdp.addTabCleanupHandler?.((id) => {
      this.snapshots.delete(id)
      for (const key of this.contexts.keys())
        if (key.startsWith(`${id}:`)) this.contexts.delete(key)
    })
  }
  begin(id: number, key: string) {
    const previous = this.snapshots.get(id),
      state =
        previous?.mainFrameKey === key
          ? previous
          : {
              mainFrameKey: key,
              framesById: new Map(),
              nextPublicId: 1,
              nodeByPublicId: new Map(),
              publicIdByFrameLocalRef: new Map()
            }
    state.framesById.clear()
    state.nodeByPublicId.clear()
    if (state.publicIdByFrameLocalRef.size > 5000) {
      state.publicIdByFrameLocalRef.clear()
      state.nextPublicId = 1
    }
    this.snapshots.set(id, state)
  }
  frame(id: number, frame: DomFrame) {
    this.snapshots.get(id)?.framesById.set(frame.frameId, frame)
  }
  ref(id: number, frame: DomFrame, localRef: string, viewportClip: ViewportClip) {
    const state = this.snapshots.get(id)
    if (state == null) throw Error('DOM CUA snapshot state is missing')
    const key = `${frame.frameId}:${frame.loaderId ?? ''}:${localRef}`
    let publicId = state.publicIdByFrameLocalRef.get(key)
    if (publicId == null) {
      publicId = String(state.nextPublicId++)
      state.publicIdByFrameLocalRef.set(key, publicId)
    }
    state.nodeByPublicId.set(publicId, {
      frameId: frame.frameId,
      loaderId: frame.loaderId,
      localRef,
      target: frame.target,
      viewportClip
    })
    return publicId
  }
  lookup(id: number, ref: string) {
    const node = this.snapshots.get(id)?.nodeByPublicId.get(ref)
    if (node == null) throw Error(`DOM node ${ref} is stale or missing`)
    return node
  }
  async evaluate(
    cdp: DomCdp,
    target: CdpTarget,
    frameId: string,
    loaderId: string | undefined,
    expression: string,
    options: { returnByValue: boolean; timeoutMs?: number }
  ) {
    const key = `${targetKey(target)}:${frameId}:${loaderId ?? ''}`
    const context = async () => {
      let value = this.contexts.get(key)
      if (value != null) return value
      const response = await cdp.callTarget(
        target,
        'Page.createIsolatedWorld',
        { frameId, grantUniveralAccess: false, worldName: 'browser-use-dom-cua' },
        { timeoutMs: options.timeoutMs }
      )
      value = { executionContextId: response.executionContextId }
      this.contexts.set(key, value)
      if (this.contexts.size > 50) {
        const first = this.contexts.keys().next().value
        if (first !== undefined) this.contexts.delete(first)
      }
      return value
    }
    const dispatch = async (value: { executionContextId: number }) =>
      await cdp.callTarget(
        target,
        'Runtime.evaluate',
        {
          awaitPromise: true,
          contextId: value.executionContextId,
          expression,
          returnByValue: options.returnByValue,
          timeout: options.timeoutMs
        },
        { timeoutMs: options.timeoutMs }
      )
    try {
      return await dispatch(await context())
    } catch (error) {
      if (
        !/Cannot find context|Execution context was destroyed|context.*destroyed|context.*not found/i.test(
          error instanceof Error ? error.message : String(error)
        )
      )
        throw error
      this.contexts.delete(key)
      return await dispatch(await context())
    }
  }
  private async parentPoint(
    cdp: DomCdp,
    parent: DomFrame,
    frame: DomFrame,
    point: InputPoint,
    guarded: boolean
  ) {
    const { backendNodeId } = await cdp.callTarget(parent.target, 'DOM.getFrameOwner', {
      frameId: frame.frameId
    })
    let size = frame.size,
      quad: number[] | undefined
    if (guarded) {
      const [model, viewport] = await Promise.all([
        cdp.callTarget(parent.target, 'DOM.getBoxModel', { backendNodeId }),
        this.evaluate(
          cdp,
          frame.target,
          frame.frameId,
          frame.loaderId,
          '({width: innerWidth, height: innerHeight})',
          { returnByValue: true }
        )
      ])
      size = viewport.result.value
      if (
        viewport.exceptionDetails != null ||
        size == null ||
        !Number.isFinite(size.width) ||
        !Number.isFinite(size.height)
      )
        throw Error('Could not inspect the DOM CUA frame viewport')
      quad = model.model.content
    } else
      quad = (await cdp.callTarget(parent.target, 'DOM.getContentQuads', { backendNodeId }))
        .quads[0]
    if (quad == null || quad.length < 8)
      throw Error(`Missing frame geometry for DOM CUA frame ${frame.frameId}`)
    if (size != null) {
      const x = point.x / size.width,
        y = point.y / size.height
      return {
        x: quad[0]! + x * (quad[2]! - quad[0]!) + y * (quad[6]! - quad[0]!),
        y: quad[1]! + x * (quad[3]! - quad[1]!) + y * (quad[7]! - quad[1]!)
      }
    }
    return {
      x: Math.min(quad[0]!, quad[2]!, quad[4]!, quad[6]!) + point.x,
      y: Math.min(quad[1]!, quad[3]!, quad[5]!, quad[7]!) + point.y
    }
  }
  private async mappedPoint(
    id: number,
    cdp: DomCdp,
    frameId: string,
    point: InputPoint,
    guarded: boolean,
    local: boolean
  ) {
    const frames = this.snapshots.get(id)?.framesById
    let frame = frames?.get(frameId),
      result = point
    if (frame == null) throw Error(`Missing DOM CUA frame ${frameId}`)
    while (frame.parentFrameId != null) {
      const parent = frames!.get(frame.parentFrameId)
      if (parent == null) throw Error(`Missing parent DOM CUA frame ${frame.frameId}`)
      if (local && !sameTarget(frame.target, parent.target)) break
      result = await this.parentPoint(cdp, parent, frame, result, guarded)
      frame = parent
      if (!local)
        while (frame.parentFrameId != null) {
          const ancestor = frames!.get(frame.parentFrameId)
          if (ancestor == null) throw Error(`Missing parent DOM CUA frame ${frame.frameId}`)
          if (!sameTarget(frame.target, ancestor.target)) break
          frame = ancestor
        }
    }
    return result
  }
  async point(id: number, cdp: DomCdp, ref: string, guarded = false) {
    const node = this.lookup(id, ref),
      response = await this.evaluate(
        cdp,
        node.target,
        node.frameId,
        node.loaderId,
        `(() => {\n    const __name = (target) => target;\n    return (${visiblePoint.toString()})(${JSON.stringify(node.localRef)}, ${JSON.stringify(node.viewportClip)});\n  })()`,
        { returnByValue: true }
      )
    if (response.exceptionDetails != null) {
      const detail = response.exceptionDetails
      throw Error(
        typeof detail.exception?.value === 'string'
          ? detail.exception.value
          : (detail.exception?.description ?? detail.text ?? 'DOM node failed')
      )
    }
    const point = response.result.value
    if (
      point == null ||
      typeof point !== 'object' ||
      typeof point.x !== 'number' ||
      typeof point.y !== 'number'
    )
      throw Error(`DOM node ${ref} is stale or missing`)
    return {
      inputPoint: await this.mappedPoint(id, cdp, node.frameId, point, guarded, true),
      point: await this.mappedPoint(id, cdp, node.frameId, point, guarded, false),
      target: node.target
    }
  }
}
