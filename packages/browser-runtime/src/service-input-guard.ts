import type { CdpTarget } from './service-cdp-execution.js'
import type { CdpOptions } from './service-cdp-attachment.js'
export interface InputPoint {
  x: number
  y: number
}
interface FrameTree {
  frame: { id: string; parentId?: string }
  childFrames?: FrameTree[]
}
export interface InputGuardCdp {
  callTarget(
    target: CdpTarget,
    method: string,
    params: Record<string, unknown> | undefined,
    options: CdpOptions
  ): Promise<any>
  targetForFrameOrAttach(
    tabId: number,
    frameId: string | null,
    options: CdpOptions,
    hints: { parentTarget: CdpTarget }
  ): Promise<CdpTarget | null>
}
export async function inputGuardWorld(cdp: InputGuardCdp, target: CdpTarget, options: CdpOptions) {
  const { frameTree } = await cdp.callTarget(target, 'Page.getFrameTree', undefined, options)
  return (await cdp.callTarget(
    target,
    'Page.createIsolatedWorld',
    {
      frameId: frameTree.frame.id,
      grantUniveralAccess: false,
      worldName: 'browser-use-input-guard'
    },
    options
  )) as { executionContextId: number }
}
function nodeRoot(this: any) {
  const node = 'getRootNode' in this ? this : this.element
  if (!node.isConnected) throw Error('Click target is detached')
  return node.getRootNode()
}
function hostRoot(this: any) {
  return this.host.getRootNode()
}
export async function checkNodeShadow(
  cdp: InputGuardCdp,
  target: CdpTarget,
  backendNodeId: number,
  options: CdpOptions = {}
) {
  const { executionContextId } = await inputGuardWorld(cdp, target, options),
    { object } = await cdp.callTarget(
      target,
      'DOM.resolveNode',
      { backendNodeId, executionContextId },
      options
    ),
    nodeId = object.objectId
  if (nodeId == null) throw Error('Click target is no longer available')
  const objects = [nodeId]
  const inspect = async (objectId: string, read: () => unknown) => {
    const response = await cdp.callTarget(
        target,
        'Runtime.callFunctionOn',
        { objectId, functionDeclaration: read.toString() },
        options
      ),
      rootId = response.result.objectId
    if (rootId != null) objects.push(rootId)
    if (response.exceptionDetails != null || rootId == null)
      throw Error("Could not check the click target's shadow root")
    const { node } = await cdp.callTarget(
      target,
      'DOM.describeNode',
      { objectId: rootId, depth: 0 },
      options
    )
    return { objectId: rootId, node }
  }
  try {
    let root = await inspect(nodeId, nodeRoot)
    while (root.node.shadowRootType !== undefined)
      switch (root.node.shadowRootType) {
        case 'closed':
          throw Error('Cannot click content inside a closed shadow root')
        case 'open':
        case 'user-agent':
          root = await inspect(root.objectId, hostRoot)
          break
      }
  } finally {
    await Promise.all(
      objects.map((objectId) =>
        cdp.callTarget(target, 'Runtime.releaseObject', { objectId }, options).catch(() => {})
      )
    )
  }
}
function framePath(tree: FrameTree, id: string): string[] | undefined {
  if (tree.frame.id === id) return []
  for (const child of tree.childFrames ?? []) {
    const path = framePath(child, id)
    if (path !== undefined) return [child.frame.id, ...path]
  }
}
export function iframeInputPoint(
  point: InputPoint,
  quad: number[],
  viewport: { width: number; height: number }
): InputPoint {
  const [left, top, rightX, rightY, oppositeX, oppositeY, bottomX, bottomY] = quad
  if (
    left == null ||
    top == null ||
    rightX == null ||
    rightY == null ||
    oppositeX == null ||
    oppositeY == null ||
    bottomX == null ||
    bottomY == null
  )
    throw Error('Missing click target iframe geometry')
  const horizontalX = rightX - left,
    horizontalY = rightY - top,
    verticalX = bottomX - left,
    verticalY = bottomY - top,
    determinant = horizontalX * verticalY - horizontalY * verticalX
  if (
    Math.abs(determinant) < 0.001 ||
    Math.abs(oppositeX - rightX - bottomX + left) > 0.01 ||
    Math.abs(oppositeY - rightY - bottomY + top) > 0.01
  )
    throw Error('Unsupported click target iframe transform')
  const result = {
    x:
      (((point.x - left) * verticalY - (point.y - top) * verticalX) * viewport.width) / determinant,
    y:
      ((horizontalX * (point.y - top) - horizontalY * (point.x - left)) * viewport.height) /
      determinant
  }
  if (!Number.isInteger(result.x) || !Number.isInteger(result.y))
    throw Error('Cannot safely inspect fractional iframe input coordinates')
  return result
}
async function checkedFramePath(
  cdp: InputGuardCdp,
  target: CdpTarget,
  point: InputPoint,
  options: CdpOptions,
  stopAt?: string
): Promise<string[]> {
  const [{ cssVisualViewport }, { frameTree }] = await Promise.all([
      cdp.callTarget(target, 'Page.getLayoutMetrics', undefined, options),
      cdp.callTarget(target, 'Page.getFrameTree', undefined, options)
    ]),
    { backendNodeId, frameId } = await cdp.callTarget(
      target,
      'DOM.getNodeForLocation',
      {
        x: Math.round(point.x + cssVisualViewport.pageX),
        y: Math.round(point.y + cssVisualViewport.pageY)
      },
      options
    )
  await checkNodeShadow(cdp, target, backendNodeId, options)
  const path = framePath(frameTree, frameId)
  if (path === undefined) throw Error('Click target frame is no longer available')
  for (const frame of path) {
    const owner = await cdp.callTarget(target, 'DOM.getFrameOwner', { frameId: frame }, options)
    await checkNodeShadow(cdp, target, owner.backendNodeId, options)
  }
  const { node } = await cdp.callTarget(
    target,
    'DOM.describeNode',
    { backendNodeId, depth: 0 },
    options
  )
  if (!['iframe', 'frame'].includes(node.localName) || node.contentDocument != null)
    return [frameTree.frame.id]
  const nested = await cdp.targetForFrameOrAttach(target.tabId, node.frameId ?? null, options, {
    parentTarget: target
  })
  if (nested == null || node.frameId == null)
    throw Error('Could not inspect the click target iframe')
  const [{ model }, { executionContextId }, { frameTree: childTree }] = await Promise.all([
    cdp.callTarget(target, 'DOM.getBoxModel', { backendNodeId }, options),
    inputGuardWorld(cdp, nested, options),
    cdp.callTarget(nested, 'Page.getFrameTree', undefined, options)
  ])
  if (childTree.frame.id !== node.frameId || childTree.frame.parentId !== frameId)
    throw Error('Click target iframe changed during inspection')
  if (childTree.frame.id === stopAt) return [frameTree.frame.id, childTree.frame.id]
  const evaluated = await cdp.callTarget(
      nested,
      'Runtime.evaluate',
      {
        contextId: executionContextId,
        expression: '({width: innerWidth, height: innerHeight})',
        returnByValue: true
      },
      options
    ),
    viewport = evaluated.result.value
  if (
    evaluated.exceptionDetails != null ||
    viewport == null ||
    typeof viewport.width !== 'number' ||
    typeof viewport.height !== 'number'
  )
    throw Error('Could not inspect the click target iframe viewport')
  return [
    frameTree.frame.id,
    ...(await checkedFramePath(
      cdp,
      nested,
      iframeInputPoint(point, model.content, viewport),
      options,
      stopAt
    ))
  ]
}
export async function checkMouseInput(
  cdp: InputGuardCdp,
  target: CdpTarget,
  point: InputPoint,
  options: CdpOptions,
  topLevelPoint?: InputPoint
) {
  if (target.sessionId != null || target.targetId != null) {
    if (topLevelPoint == null) throw Error('Missing top-level coordinates for the click target')
    const { frameTree } = await cdp.callTarget(target, 'Page.getFrameTree', undefined, options)
    if (
      !(
        await checkedFramePath(
          cdp,
          { tabId: target.tabId },
          topLevelPoint,
          options,
          frameTree.frame.id
        )
      ).includes(frameTree.frame.id)
    )
      throw Error('Click target is not on the checked iframe path')
  }
  await checkedFramePath(cdp, target, point, options)
}
function activeFocus(this: any) {
  let active = this.activeElement
  while (active?.shadowRoot?.activeElement != null) active = active.shadowRoot.activeElement
  return active
}
async function releaseInputObject(
  cdp: InputGuardCdp,
  target: CdpTarget,
  objectId: string | undefined,
  options: CdpOptions
) {
  if (objectId != null)
    await cdp.callTarget(target, 'Runtime.releaseObject', { objectId }, options).catch(() => {})
}
async function inspectFocus(
  cdp: InputGuardCdp,
  target: CdpTarget,
  options: CdpOptions,
  rootNode?: number
) {
  const { executionContextId } = await inputGuardWorld(cdp, target, options)
  let rootId: string | undefined
  try {
    if (rootNode != null) {
      const { object } = await cdp.callTarget(
        target,
        'DOM.resolveNode',
        { backendNodeId: rootNode, executionContextId },
        options
      )
      rootId = object.objectId
      if (rootId == null) throw Error('Keyboard focus root is no longer available')
    }
    const result =
      rootId == null
        ? await cdp.callTarget(
            target,
            'Runtime.evaluate',
            {
              expression: `(${activeFocus.toString()}).call(document)`,
              contextId: executionContextId,
              returnByValue: false
            },
            options
          )
        : await cdp.callTarget(
            target,
            'Runtime.callFunctionOn',
            { objectId: rootId, functionDeclaration: activeFocus.toString(), returnByValue: false },
            options
          )
    if (result.exceptionDetails != null) throw Error('Could not inspect keyboard focus')
    return result.result as { subtype?: string; objectId?: string }
  } finally {
    await releaseInputObject(cdp, target, rootId, options)
  }
}
export async function checkKeyboardFocus(cdp: InputGuardCdp, tabId: number, options: CdpOptions) {
  let target: CdpTarget = { tabId },
    rootNode: number | undefined
  for (;;) {
    const focused = await inspectFocus(cdp, target, options, rootNode)
    if (focused.subtype === 'null') return
    const objectId = focused.objectId
    if (objectId == null) throw Error('Could not inspect keyboard focus')
    const inspected = target
    try {
      const { node } = await cdp.callTarget(
          target,
          'DOM.describeNode',
          { objectId, depth: 0 },
          options
        ),
        closed = node.shadowRoots?.find((root: any) => root.shadowRootType === 'closed')
      if (closed != null) {
        const inner = await inspectFocus(cdp, target, options, closed.backendNodeId)
        await releaseInputObject(cdp, target, inner.objectId, options)
        if (inner.subtype !== 'null') throw Error('Cannot send keys into a closed shadow root')
      }
      if (!['iframe', 'frame'].includes(node.localName)) return
      if (node.contentDocument != null) rootNode = node.contentDocument.backendNodeId
      else {
        if (node.frameId == null) throw Error('Focused iframe is no longer available')
        const child = await cdp.targetForFrameOrAttach(tabId, node.frameId, options, {
          parentTarget: target
        })
        if (child == null) throw Error('Could not inspect the focused iframe')
        target = child
        rootNode = undefined
      }
    } finally {
      await releaseInputObject(cdp, inspected, objectId, options)
    }
  }
}
