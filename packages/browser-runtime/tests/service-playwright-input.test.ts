// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { JSDOM } from 'jsdom'
import { CommandTiming } from '../src/service-command-timing'
import { originalDocumentation } from './original-service'
const candidate = async () =>
  ((await import('../src/service-playwright-input').catch(() => ({}))) as any).PlaywrightInput
const span = { currentPlaywrightOperation: (fallback: string) => fallback }
const normalize = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (key, val) =>
      ['deadlineMs', 'timeoutMs'].includes(key) ? undefined : val
    )
  )
function pageFixture() {
  const dom = new JSDOM(
      '<body><input id="text" value="before"><input id="date" type="date"><input id="check" type="checkbox" checked><input id="radio" type="radio" checked><button id="button">Go</button><input id="disabled" disabled></body>',
      { runScripts: 'outside-only', pretendToBeVisual: true }
    ),
    w = dom.window,
    calls: string[] = []
  const style = w.getComputedStyle.bind(w)
  w.getComputedStyle = (el) => style(el)
  w.Element.prototype.scrollIntoView = function (options) {
    calls.push('scroll:' + this.id + ':' + JSON.stringify(options))
  }
  w.Element.prototype.getClientRects = () =>
    [{ left: 10, right: 110, top: 20, bottom: 50, width: 100, height: 30 }] as any
  w.Element.prototype.getBoundingClientRect = () =>
    ({ left: 10, right: 110, top: 20, bottom: 50, width: 100, height: 30 }) as any
  const cdp = Object.assign(new EventEmitter(), {
    platform: 'darwin',
    callTarget: async (_target: any, method: string, params: any) => {
      calls.push(method)
      if (method === 'Runtime.evaluate')
        return { result: { value: await w.eval(params.expression) } }
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
      return {}
    }
  })
  return { dom, w, cdp, calls }
}
test('focus, fill, sequential input and checked states execute real page programs like original', async () => {
  const Own = await candidate()
  expect(typeof Own).toBe('function')
  const original = await originalDocumentation()
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  async function exercise(baseline: boolean, iab: boolean) {
    const { w, cdp, calls } = pageFixture(),
      api = baseline
        ? new original.BaselinePlaywright(cdp, {}, span, original.baselineCommandTiming, iab)
        : new Own(cdp, {}, span, new CommandTiming(), iab),
      results: any[] = []
    try {
      for (const [name, selector, extra] of [
        ['focusLocator', '#text', { requireEditable: true, selectText: true }],
        ['prepareLocatorFill', '#text', 'hello'],
        ['prepareLocatorFill', '#date', '2026-09-28'],
        ['prepareSequentialInput', '#text', Date.now() + 3000],
        ['readCheckedState', '#check', null],
        ['readCheckedState', '#radio', null],
        ['readElementState', '#disabled', 'enabled'],
        ['readElementState', '#missing', 'visible']
      ] as const) {
        results.push(await api[name]({ tab_id: 1, selector, timeout_ms: 100 }, extra))
      }
      const text = w.document.querySelector('#text') as any
      return normalize({
        results,
        calls,
        date: (w.document.querySelector('#date') as any).value,
        focused: w.document.activeElement?.id,
        selection: [text.selectionStart, text.selectionEnd],
        inputToken: text.__codexIabInputTargetToken,
        sequentialToken: text.__codexPressSequentiallyTargetToken
      })
    } finally {
      w.close()
    }
  }
  try {
    for (const iab of [false, true])
      expect(await exercise(false, iab)).toEqual(await exercise(true, iab))
  } finally {
    vi.restoreAllMocks()
  }
})
test('pointer actions use stable geometry and mac modifiers, retry frame obstruction and honor force', async () => {
  const Own = await candidate()
  expect(typeof Own).toBe('function')
  const original = await originalDocumentation()
  async function exercise(
    baseline: boolean,
    force: boolean,
    obstructed: boolean,
    session: boolean
  ) {
    const { w, cdp, calls } = pageFixture(),
      dispatch: any[] = [],
      cua = { clickPoint: async (action: any) => dispatch.push(action) },
      api = baseline
        ? new original.BaselinePlaywright(cdp, cua, span, original.baselineCommandTiming)
        : new Own(cdp, cua, span, new CommandTiming())
    const originalEvaluate = api.evaluateOnPlaywrightSelectorWithTarget.bind(api)
    api.evaluateOnPlaywrightSelectorWithTarget = async (...args: any[]) => {
      const result = await originalEvaluate(...args)
      return { ...result, target: { tabId: 1, ...(session ? { sessionId: 'child' } : {}) } }
    }
    let checks = 0
    api.obstructingFrameHitTarget = async () => {
      checks++
      return obstructed ? '<div#overlay>' : checks === 1 ? '<div#temporary>' : null
    }
    let error
    try {
      await api.clickLocator(
        {
          tab_id: 1,
          selector: '#button',
          button: 'right',
          modifiers: ['Alt', 'ControlOrMeta', 'Shift', 'unknown'],
          force,
          timeout_ms: 100
        },
        2
      )
    } catch (e: any) {
      error = e.message
    } finally {
      w.close()
    }
    return normalize({ dispatch, error, calls, checks })
  }
  for (const force of [false, true])
    for (const obstructed of [false, true])
      for (const session of [false, true])
        expect(await exercise(false, force, obstructed, session)).toEqual(
          await exercise(true, force, obstructed, session)
        )
})
test('OOPIF coordinate recomputation and obstruction descriptions preserve original CDP requests', async () => {
  const Own = await candidate()
  expect(typeof Own).toBe('function')
  const original = await originalDocumentation()
  async function exercise(baseline: boolean, iab: boolean, mode: string) {
    const calls: any[] = [],
      cdp = Object.assign(new EventEmitter(), {
        callTarget: async (target: any, method: string, params: any, options: any) => {
          calls.push([target, method, params, options])
          if (mode === 'failure' && method === 'DOM.getNodeForLocation') throw Error('closed')
          if (method === 'DOM.getFrameOwner') return { backendNodeId: 7 }
          if (method === 'DOM.getBoxModel')
            return {
              model: { content: mode === 'missing' ? [] : [10, 20, 210, 40, 190, 200, -10, 180] }
            }
          if (method === 'DOM.getContentQuads')
            return { quads: [mode === 'missing' ? [] : [10, 20, 210, 40, 190, 200, -10, 180]] }
          if (method === 'DOM.getNodeForLocation')
            return {
              backendNodeId: mode === 'owner' ? 7 : 8,
              frameId: mode === 'same-frame' ? 'frame' : 'other'
            }
          if (method === 'DOM.describeNode')
            return {
              node: { nodeName: 'DIV', attributes: ['id', 'cover', 'class', 'one two three four'] }
            }
          return {}
        }
      }),
      api = baseline
        ? new original.BaselinePlaywright(cdp, {}, span, original.baselineCommandTiming, iab)
        : new Own(cdp, {}, span, new CommandTiming(), iab)
    let result, error
    try {
      result = await api.currentTopLevelPointForAction(
        { x: 25, y: 20 },
        [
          {
            frameId: mode === 'no-id' ? null : 'frame',
            parentTarget: { tabId: 1 },
            size: { width: 100, height: 80 }
          }
        ],
        { timeoutMs: 100 }
      )
      result = {
        ...result,
        obstruction: await api.obstructingFrameHitTarget(result, { timeoutMs: 100 })
      }
    } catch (e: any) {
      error = e.message
    }
    return normalize({ result, error, calls })
  }
  for (const iab of [false, true])
    for (const mode of ['owner', 'same-frame', 'overlay', 'failure', 'missing', 'no-id'])
      expect(await exercise(false, iab, mode)).toEqual(await exercise(true, iab, mode))
})
test('accessibility-node focus pins the node handle and releases it after focus', async () => {
  const Own = await candidate(),
    original = await originalDocumentation()
  async function exercise(baseline: boolean) {
    const { w, cdp, calls } = pageFixture(),
      dispatch = cdp.callTarget
    cdp.callTarget = async (target: any, method: string, params: any) => {
      if (method === 'DOM.resolveNode') {
        calls.push(method)
        return { object: { objectId: 'node' } }
      }
      if (method === 'Runtime.callFunctionOn') {
        calls.push(method)
        return {
          result: {
            value: await w
              .eval('(' + params.functionDeclaration + ')')
              .call(
                w.document.querySelector('#text'),
                ...(params.arguments ?? []).map((arg: any) => arg.value)
              )
          }
        }
      }
      return dispatch(target, method, params)
    }
    const api = baseline
      ? new original.BaselinePlaywright(cdp, {}, span, original.baselineCommandTiming)
      : new Own(cdp, {}, span, new CommandTiming())
    try {
      await api.ensurePlaywrightInjectedInTarget({ tabId: 1 })
      return normalize({
        result: await api.focusNode(
          { backendNodeId: 7, target: { tabId: 1 }, oopifFrameChain: [] },
          { requireEditable: true, selectText: true, timeoutMs: 100 }
        ),
        focused: w.document.activeElement?.id,
        calls
      })
    } finally {
      w.close()
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('disabled fill and checked on a non-checkbox report original page errors without mutation', async () => {
  const Own = await candidate(),
    original = await originalDocumentation()
  async function exercise(baseline: boolean, command: string) {
    const { w, cdp, calls } = pageFixture(),
      api = baseline
        ? new original.BaselinePlaywright(cdp, {}, span, original.baselineCommandTiming)
        : new Own(cdp, {}, span, new CommandTiming())
    let error
    try {
      await api[command](
        {
          tab_id: 1,
          selector: command === 'prepareLocatorFill' ? '#disabled' : '#button',
          timeout_ms: 0
        },
        'value'
      )
    } catch (e: any) {
      error = e.message
    } finally {
      w.close()
    }
    return { error, calls }
  }
  for (const command of ['prepareLocatorFill', 'readCheckedState'])
    expect(await exercise(false, command)).toEqual(await exercise(true, command))
})
