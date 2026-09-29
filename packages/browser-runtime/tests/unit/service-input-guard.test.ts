// @vitest-environment node
import { test, expect } from 'vitest'
import { checkMouseInput, checkNodeShadow, iframeInputPoint } from '../../src/service-input-guard'
import { originalDocumentation } from '../original-service'
function fixture(roots: (string | undefined)[]) {
  const calls: any[] = [],
    remaining = [...roots]
  let rootIndex = 0
  const cdp = {
    callTarget: async (target: any, method: string, params: any, options: any) => {
      calls.push([target, method, params?.functionDeclaration ? 'function' : params, options])
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
      if (method === 'DOM.resolveNode') return { object: { objectId: 'node' } }
      if (method === 'Runtime.callFunctionOn') return { result: { objectId: 'root' + rootIndex++ } }
      if (method === 'DOM.describeNode')
        return params.objectId
          ? { node: { shadowRootType: remaining.shift() } }
          : { node: { localName: 'button' } }
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { pageX: 0, pageY: 0 } }
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: 1, frameId: 'main' }
      return {}
    },
    targetForFrameOrAttach: async () => null
  }
  return { cdp, calls }
}
test('node input guard rejects closed shadow roots and releases all inspected objects', async () => {
  const base = await originalDocumentation()
  for (const roots of [
    [undefined],
    ['open', undefined],
    ['open', 'closed'],
    ['user-agent', undefined]
  ]) {
    async function exercise(check: any) {
      const f = fixture(roots),
        target = { tabId: 1 }
      let error
      try {
        await check(f.cdp, target, 1, {})
      } catch (e: any) {
        error = e.message
      }
      return { error, calls: f.calls }
    }
    expect(await exercise(checkNodeShadow)).toEqual(await exercise(base.baselineCheckNodeShadow))
  }
})
test('mouse input checks layout, frame path and shadow before dispatch', async () => {
  const base = await originalDocumentation()
  async function exercise(check: any) {
    const f = fixture([undefined])
    await check(f.cdp, { tabId: 1 }, { x: 10.3, y: 20.6 }, {})
    return f.calls
  }
  expect(await exercise(checkMouseInput)).toEqual(await exercise(base.baselineCheckMouseInput))
})
test('nested targets require top-level coordinates and verified parent frame path', async () => {
  const base = await originalDocumentation()
  for (const coordinates of [undefined, { x: 10, y: 20 }]) {
    async function exercise(check: any) {
      const f = fixture([undefined])
      try {
        await check(f.cdp, { tabId: 1, sessionId: 'nested' }, { x: 1, y: 2 }, {}, coordinates)
      } catch (e: any) {
        return { error: e.message, calls: f.calls }
      }
    }
    expect(await exercise(checkMouseInput)).toEqual(await exercise(base.baselineCheckMouseInput))
  }
})
test('iframe affine conversion accepts exact integer inputs and rejects unsafe transforms', async () => {
  const base = await originalDocumentation()
  for (const quad of [
    [0, 0, 100, 0, 100, 100, 0, 100],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 100, 0, 90, 100, 0, 100],
    []
  ])
    for (const point of [
      { x: 10, y: 20 },
      { x: 10.5, y: 20 }
    ]) {
      function exercise(convert: any) {
        try {
          return convert(point, quad, { width: 100, height: 100 })
        } catch (e: any) {
          return e.message
        }
      }
      expect(exercise(iframeInputPoint)).toEqual(exercise(base.baselineIframeInputPoint))
    }
})
test('keyboard focus guard rejects focused closed roots and releases inspected objects', async () => {
  const base = await originalDocumentation(),
    candidate = await import('../../src/service-input-guard')
  for (const focused of [true, false])
    for (const closed of [true, false]) {
      async function exercise(check: any) {
        const calls: any[] = [],
          cdp = {
            callTarget: async (_target: any, method: any, params: any) => {
              calls.push([
                method,
                params?.expression
                  ? 'expression'
                  : params?.functionDeclaration
                    ? 'function'
                    : params
              ])
              if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
              if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
              if (method === 'Runtime.evaluate')
                return { result: focused ? { objectId: 'focus' } : { subtype: 'null' } }
              if (method === 'DOM.describeNode')
                return {
                  node: {
                    localName: 'input',
                    shadowRoots: closed ? [{ shadowRootType: 'closed', backendNodeId: 2 }] : []
                  }
                }
              if (method === 'DOM.resolveNode') return { object: { objectId: 'root' } }
              if (method === 'Runtime.callFunctionOn') return { result: { objectId: 'inner' } }
              return {}
            },
            targetForFrameOrAttach: async () => null
          }
        let error
        try {
          await check(cdp, 1, {})
        } catch (e: any) {
          error = e.message
        }
        return { calls, error }
      }
      expect(await exercise(candidate.checkKeyboardFocus)).toEqual(
        await exercise(base.baselineCheckKeyboardFocus)
      )
    }
})
