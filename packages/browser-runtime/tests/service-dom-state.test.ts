// @vitest-environment node
import { test, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { DomSnapshotState } from '../src/service-dom-state'
import { originalDocumentation } from './original-service'
function candidate() {
  return new DomSnapshotState()
}
async function original() {
  const base = await originalDocumentation()
  return {
    registerCleanup: base.baselineDomCleanup,
    begin: base.baselineDomBegin,
    frame: base.baselineDomFrame,
    ref: base.baselineDomRef,
    lookup: base.baselineDomLookup,
    point: base.baselineDomPoint,
    evaluate: base.baselineDomEvaluate
  }
}
test('snapshot IDs remain stable within a document and stale references and cleanup reject', async () => {
  async function exercise(state: any) {
    let cleanup: any
    state.registerCleanup({
      addTabCleanupHandler: (callback: any) => {
        cleanup = callback
      }
    })
    const frame = { frameId: 'top', loaderId: 'document', target: { tabId: 40 } }
    state.begin(40, 'document')
    state.frame(40, frame)
    const first = state.ref(40, frame, 'ref', { left: 0, top: 0, right: 100, bottom: 100 })
    state.begin(40, 'document')
    state.frame(40, frame)
    const second = state.ref(40, frame, 'ref', { left: 0, top: 0, right: 100, bottom: 100 })
    const node = state.lookup(40, second)
    state.begin(40, 'other')
    let stale
    try {
      state.lookup(40, second)
    } catch (e: any) {
      stale = e.message
    }
    state.frame(40, frame)
    const third = state.ref(40, frame, 'next', {})
    cleanup(40)
    let removed
    try {
      state.lookup(40, third)
    } catch (e: any) {
      removed = e.message
    }
    return { first, second, node, stale, removed }
  }
  expect(await exercise(candidate())).toEqual(await exercise(await original()))
})
test('node geometry maps into parent and target-local viewports and missing contexts retry once', async () => {
  async function exercise(state: any, guarded: boolean) {
    const calls: any[] = []
    let evaluations = 0
    let cleanup: any
    const cdp = {
      addTabCleanupHandler: (callback: any) => {
        cleanup = callback
      },
      callTarget: async (target: any, method: string, params: any, options: any) => {
        calls.push([
          target,
          method,
          method === 'Runtime.evaluate' ? { ...params, expression: 'script' } : params,
          options
        ])
        if (method === 'Page.createIsolatedWorld') return { executionContextId: calls.length }
        if (method === 'Runtime.evaluate') {
          if (++evaluations === 1) throw Error('Execution context was destroyed')
          return {
            result: {
              value: params.expression.includes('innerWidth')
                ? { width: 100, height: 100 }
                : { x: 25, y: 50 }
            }
          }
        }
        if (method === 'DOM.getFrameOwner') return { backendNodeId: 7 }
        if (method === 'DOM.getContentQuads')
          return { quads: [[10, 20, 210, 20, 210, 220, 10, 220]] }
        if (method === 'DOM.getBoxModel')
          return { model: { content: [10, 20, 210, 20, 210, 220, 10, 220] } }
        throw Error(method)
      }
    }
    const top = {
        frameId: 'top',
        loaderId: 'one',
        target: { tabId: 41 },
        size: { width: 400, height: 400 }
      },
      child = {
        frameId: 'child',
        loaderId: 'two',
        target: { tabId: 41, sessionId: 'child' },
        parentFrameId: 'top',
        size: { width: 100, height: 100 }
      }
    state.registerCleanup(cdp)
    state.begin(41, 'one')
    state.frame(41, top)
    state.frame(41, child)
    const ref = state.ref(41, child, 'r', { left: 0, top: 0, right: 100, bottom: 100 })
    const point = await state.point(41, cdp, ref, guarded)
    cleanup(41)
    return { point, calls, evaluations }
  }
  for (const guarded of [true, false])
    expect(await exercise(candidate(), guarded)).toEqual(await exercise(await original(), guarded))
})

test('serialized node lookup clips visible rectangles and rejects disconnected or hidden nodes', async () => {
  async function exercise(state: any, connected: boolean, hidden: boolean) {
    const scrolled: any[] = []
    const node = {
      isConnected: connected,
      scrollIntoView: (options: any) => scrolled.push(options),
      getClientRects: () =>
        hidden ? [] : [{ left: -20, right: 60, top: 30, bottom: 80, width: 80, height: 50 }],
      getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
    }
    const cdp = {
      callTarget: async (_target: any, method: string, params: any) => {
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
        if (method === 'Runtime.evaluate')
          return {
            result: {
              value: runInNewContext(params.expression, {
                __browserUseVisibleDomState: { refToElement: new Map([['r', node]]) }
              })
            }
          }
        throw Error(method)
      }
    }
    const frame = { frameId: 'top', loaderId: 'visible', target: { tabId: 52 } }
    state.begin(52, 'visible')
    state.frame(52, frame)
    const ref = state.ref(52, frame, 'r', { left: 0, top: 40, right: 50, bottom: 100 })
    let value, error
    try {
      value = await state.point(52, cdp, ref)
    } catch (e: any) {
      error = e.message
    }
    return { value, error, scrolled }
  }
  for (const [connected, hidden] of [
    [true, false],
    [false, false],
    [true, true]
  ])
    expect(await exercise(candidate(), connected!, hidden!)).toEqual(
      await exercise(await original(), connected!, hidden!)
    )
})
