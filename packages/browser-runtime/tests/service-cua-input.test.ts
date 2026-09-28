// @vitest-environment node
import { test, expect } from 'vitest'
import { CuaInput } from '../src/service-cua-input'
import { DomSnapshotState } from '../src/service-dom-state'
import { originalDocumentation } from './original-service'
test('CUA keypress validates command payload and dispatches macOS editing shortcuts', async () => {
  const base = await originalDocumentation()
  for (const keys of [[], null, ['Meta', 'a'], ['Shift', 'a']]) {
    async function exercise(Type: any) {
      const calls: any[] = []
      const input = new Type(
        { platform: 'darwin', call: async (...args: any[]) => calls.push(args) },
        {}
      )
      let error
      try {
        await input.dispatchKeyPress({ commandName: 'cua_keypress', tabId: 1, keys })
      } catch (e: any) {
        error = e.message
      }
      return { calls, error }
    }
    expect(await exercise(CuaInput)).toEqual(await exercise(base.BaselineCuaInput))
  }
})
test('DOM CUA click and scroll resolve registered node geometry before dispatch', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const calls: any[] = [],
      state = original
        ? { begin: base.baselineDomBegin, frame: base.baselineDomFrame, ref: base.baselineDomRef }
        : new DomSnapshotState()
    const cdp = {
      platform: 'darwin',
      call: async (...args: any[]) => calls.push(['call', ...args]),
      callTarget: async (target: any, method: string, params: any, options: any) => {
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 2 }
        if (method === 'Runtime.evaluate') return { result: { value: { x: 30, y: 40 } } }
        calls.push([
          'target',
          target,
          method,
          params,
          { ...options, deadlineMs: options?.deadlineMs == null ? undefined : 'deadline' }
        ])
      },
      waitForPageLoadEvent: async (...args: any[]) => calls.push(['load', ...args])
    }
    const frame = { frameId: 'top', loaderId: 'doc', target: { tabId: 50 } }
    state.begin(50, 'doc')
    state.frame(50, frame)
    const nodeId = state.ref(50, frame, 'r', { left: 0, top: 0, right: 100, bottom: 100 })
    const ui = { moveMouse: async (...args: any[]) => calls.push(['ui', ...args]) },
      input = original
        ? new base.BaselineCuaInput(cdp, ui)
        : new CuaInput(cdp as any, ui, 'synthesizeScrollGesture', false, state as DomSnapshotState)
    await input.clickDomCuaNode({ tabId: 50, nodeId, clickCount: 2, timeoutMs: 200 })
    await input.scrollDomCuaNode({ tabId: 50, nodeId, scrollX: 0, scrollY: 25 })
    return calls
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
