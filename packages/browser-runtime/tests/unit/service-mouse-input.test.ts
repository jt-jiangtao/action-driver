// @vitest-environment node
import { test, expect } from 'vitest'
import { MouseInput } from '../../src/service-mouse-input'
import { originalDocumentation } from '../original-service'
function fixture(Type: any, scroll = 'synthesizeScrollGesture', fail = false) {
  const calls: any[] = [],
    cdp = {
      call: async (...args: any[]) => {
        calls.push(['cdp', ...args])
        if (
          fail &&
          args[1] === 'Input.dispatchMouseEvent' &&
          args[2].buttons === 1 &&
          args[2].type === 'mouseMoved'
        )
          throw Error('move failed')
        if (args[1] === 'DOM.getContentQuads') return { quads: [[0, 0, 10, 0, 10, 20, 0, 20]] }
      },
      callTarget: async (...args: any[]) => calls.push(['target', ...args]),
      waitForPageLoadEvent: async (...args: any[]) => calls.push(['wait', ...args])
    },
    ui = { moveMouse: async (...args: any[]) => calls.push(['ui', ...args]) }
  return { input: new Type(cdp, ui, scroll), calls }
}
function normalize(value: any): any {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        key === 'deadlineMs' && value !== undefined ? 'deadline' : normalize(value)
      ])
    )
  return value
}
test('mouse scroll forwards correct wheel/distance mode and drag releases pressed buttons on errors', async () => {
  const base = await originalDocumentation()
  for (const scroll of ['mouseWheel', 'synthesizeScrollGesture'])
    for (const fail of [true, false]) {
      async function exercise(Type: any) {
        const f = fixture(Type, scroll, fail)
        await f.input.scrollPoint({
          tabId: 1,
          point: { x: 10, y: 20 },
          scrollX: 0,
          scrollY: 100,
          modifiers: 2
        })
        let error
        try {
          await f.input.dragPath({
            tabId: 1,
            path: [
              { x: 1, y: 2 },
              { x: 10, y: 20 }
            ],
            modifiers: 4
          })
        } catch (e: any) {
          error = e.message
        }
        return { error, calls: normalize(f.calls) }
      }
      expect(await exercise(MouseInput)).toEqual(await exercise(base.BaselineCuaInput))
    }
})
test('click supports multiple buttons/counts and nested input/load targets with deadline metadata', async () => {
  const base = await originalDocumentation()
  for (const button of ['left', 'right', 'middle'])
    for (const nested of [true, false]) {
      async function exercise(Type: any) {
        const f = fixture(Type)
        await f.input.clickPoint({
          tabId: 1,
          point: { x: 10.2, y: 20.3 },
          inputPoint: { x: 1, y: 2 },
          ...(nested
            ? {
                inputTarget: { tabId: 1, sessionId: 'frame' },
                loadTarget: { tabId: 1, sessionId: 'frame' }
              }
            : {}),
          clickCount: 2,
          button,
          modifiers: 1,
          timeoutMs: 100
        })
        return normalize(f.calls)
      }
      expect(await exercise(MouseInput)).toEqual(await exercise(base.BaselineCuaInput))
    }
})
test('geometry finds quad center and point rounding is restricted to input-guard mode', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type)
    const point = await f.input.getBackendNodeViewportPoint(1, 2)
    const precise = f.input.mouseInputPoint({ x: 1.2, y: 2.8 })
    f.input.blockClosedShadowInput = true
    return { point, precise, rounded: f.input.mouseInputPoint({ x: 1.2, y: 2.8 }), calls: f.calls }
  }
  expect(await exercise(MouseInput)).toEqual(await exercise(base.BaselineCuaInput))
})
test('empty drag and missing node geometry preserve original errors', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type),
      errors = []
    try {
      await f.input.dragPath({ tabId: 1, path: [], modifiers: 0 })
    } catch (e: any) {
      errors.push(e.message)
    }
    f.input.cdp.call = async (_id: any, method: any) =>
      method === 'DOM.getContentQuads' ? { quads: [] } : { model: { border: [] } }
    try {
      await f.input.getBackendNodeViewportPoint(1, 2)
    } catch (e: any) {
      errors.push(e.message)
    }
    return errors
  }
  expect(await exercise(MouseInput)).toEqual(await exercise(base.BaselineCuaInput))
})
