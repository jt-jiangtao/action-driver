// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PlaywrightSelectors } from '../../src/service-playwright-selectors'
import { CommandTiming } from '../../src/service-command-timing'
import { originalDocumentation } from '../original-service'
function fixture(oopif: boolean, missingId: boolean = false) {
  const calls: any[] = [],
    events = new EventEmitter()
  let routed = false
  const cdp = Object.assign(events, {
    enableOopifAutoAttach: async (...args: any[]) => calls.push(['attach', ...args]),
    targetForFrame: () => null,
    targetForFrameOrAttach: async (...args: any[]) => {
      calls.push(['frameTarget', ...args])
      return { tabId: 1, sessionId: 'child' }
    },
    callTarget: async (target: any, method: string, params: any, options: any) => {
      const expression = params?.expression ?? '',
        route = /const parsedSelector\s*=\s*initialInjected\.parseSelector/.test(expression),
        install = expression.includes('new PlaywrightInjected.InjectedScript')
      calls.push([
        target,
        method,
        {
          ...params,
          expression: params?.expression == null ? undefined : install ? 'install' : 'page',
          functionDeclaration: params?.functionDeclaration == null ? undefined : 'function'
        },
        options
      ])
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 2 }
      if (method === 'Runtime.evaluate') {
        if (install) return { result: { value: undefined } }
        if (route) {
          if (!oopif || routed) return { result: { value: null } }
          routed = true
          return { result: { objectId: 'frame' } }
        }
        return {
          result: params.returnByValue === false ? { objectId: 'element' } : { value: 'read' }
        }
      }
      if (method === 'Runtime.callFunctionOn')
        return params.objectId === 'frame'
          ? {
              result: {
                value: {
                  enterFrameCount: 1,
                  frameName: 'nested',
                  frameUrl: 'https://child.test',
                  size: { width: 100, height: 80 }
                }
              }
            }
          : params.returnByValue === false
            ? { result: { objectId: 'owner-frame' } }
            : { result: { value: 'node-value' } }
      if (method === 'DOM.describeNode')
        return { node: { backendNodeId: 7, ...(missingId ? {} : { frameId: 'child-frame' }) } }
      if (method === 'DOM.resolveNode') return { object: { objectId: 'resolved' } }
      if (method === 'Page.getFrameTree')
        return {
          frameTree: {
            frame: { id: 'main', loaderId: 'loader', url: 'https://main.test' },
            childFrames: [
              {
                frame: {
                  id: 'child-frame',
                  loaderId: 'child-loader',
                  url: 'https://child.test',
                  name: 'nested'
                }
              }
            ]
          }
        }
      return {}
    }
  })
  return { cdp, calls }
}
const normalize = (calls: any[]) =>
  JSON.parse(
    JSON.stringify(calls, (key, value) =>
      ['deadlineMs', 'timeout', 'timeoutMs'].includes(key) ? undefined : value
    )
  )
test('selector node resolution routes OOPIFs, matches missing frame IDs and releases all handles like original', async () => {
  const base = await originalDocumentation()
  async function exercise(
    original: boolean,
    oopif: boolean,
    missingId: boolean,
    isolated: boolean
  ) {
    const { cdp, calls } = fixture(oopif, missingId),
      span = { currentPlaywrightOperation: () => 'locator' },
      api = original
        ? new base.BaselinePlaywright(cdp, {}, span, base.baselineCommandTiming)
        : new PlaywrightSelectors(cdp as any, span, new CommandTiming())
    const result = await api.resolvePlaywrightSelectorNode(
      1,
      'iframe >> internal:control=enter-frame >> button',
      { retry: false, isolatedWorld: isolated, timeoutMs: 100 }
    )
    return { result, calls: normalize(calls) }
  }
  for (const oopif of [false, true])
    for (const missingId of [false, true])
      for (const isolated of [false, true])
        expect(await exercise(false, oopif, missingId, isolated)).toEqual(
          await exercise(true, oopif, missingId, isolated)
        )
})
test('bound node evaluation pins handles and rejects strict rebinding while cleaning callback failures', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean, fail: boolean) {
    const { cdp, calls } = fixture(false),
      span = { currentPlaywrightOperation: () => 'locator' },
      api = original
        ? new base.BaselinePlaywright(cdp, {}, span, base.baselineCommandTiming)
        : new PlaywrightSelectors(cdp as any, span, new CommandTiming())
    let result, error
    try {
      result = await api.withBoundPlaywrightSelector(
        1,
        'button',
        async () => true,
        async (bound: any) => {
          if (fail) throw Error('callback failed')
          return await bound.evaluateOnPlaywrightSelectorWithTarget(
            1,
            'button',
            (element: any) => element.textContent,
            { arg: { x: 1 } }
          )
        },
        { timeoutMs: 100 }
      )
    } catch (e: any) {
      error = e.message
    }
    return { result, error, calls: normalize(calls) }
  }
  for (const fail of [false, true])
    expect(await exercise(false, fail)).toEqual(await exercise(true, fail))
})
test('page, all-selector, readonly preparation and distinct reads execute serialized programs like original', async () => {
  const { JSDOM } = await import('jsdom'),
    base = await originalDocumentation()
  async function exercise(original: boolean) {
    const dom = new JSDOM(
        '<body><button id="one">First</button><button id="two">Second</button></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true }
      ),
      w = dom.window
    const style = w.getComputedStyle.bind(w)
    w.getComputedStyle = (element) => style(element)
    w.Element.prototype.getClientRects = () =>
      [{ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }] as any
    const methods: string[] = [],
      cdp = Object.assign(new EventEmitter(), {
        callTarget: async (_target: any, method: string, params: any) => {
          methods.push(method)
          if (method === 'Runtime.evaluate')
            return { result: { value: await w.eval(params.expression) } }
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
          if (method === 'DOM.resolveNode') return { object: { objectId: 'handle' } }
          if (method === 'Runtime.callFunctionOn')
            return {
              result: {
                value: await w
                  .eval('(' + params.functionDeclaration + ')')
                  .call(
                    w.document.querySelector('#one'),
                    ...(params.arguments ?? []).map((arg: any) => arg.value)
                  )
              }
            }
          return {}
        }
      }),
      span = { currentPlaywrightOperation: (fallback: string) => fallback },
      api = original
        ? new base.BaselinePlaywright(cdp, {}, span, base.baselineCommandTiming)
        : new PlaywrightSelectors(cdp as any, span, new CommandTiming())
    try {
      const page = await api.evaluateOnPlaywrightPage(
        1,
        (_injected: any, arg: any) => document.querySelectorAll(arg).length,
        { arg: 'button' }
      )
      const all = await api.evaluateOnPlaywrightSelectorAll(
        1,
        'button',
        (elements: any[], _injected: any, arg: any) =>
          elements.map((element) => element.textContent + arg),
        { arg: '!', retry: false }
      )
      const distinct = await api.selectorsResolveToDistinctElements(1, ['#one', '#two']),
        same = await api.selectorsResolveToDistinctElements(1, ['#one', '#one'])
      const prepared = await api.prepareReadonlyLocatorAll(
        1,
        'button',
        'elements.map(element=>element.textContent)'
      )
      const readonly = await w.eval(prepared.expression)
      const node = await api.evaluateOnPlaywrightNode(
        { backendNodeId: 7, target: { tabId: 1 }, oopifFrameChain: [] },
        (element: any, _injected: any, arg: any) => element.textContent + arg,
        { arg: '?' }
      )
      return JSON.parse(JSON.stringify({ page, all, distinct, same, readonly, node, methods }))
    } finally {
      w.close()
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('OOPIF frame metadata program preserves IAB padding/border geometry and validates visibility', async () => {
  const { JSDOM } = await import('jsdom'),
    base = await originalDocumentation()
  async function exercise(original: boolean, iab: boolean) {
    const dom = new JSDOM(
        '<iframe name="nested" src="https://child.test" style="width:120px;height:90px;padding:4px;border:2px solid;box-sizing:border-box"></iframe>',
        { runScripts: 'outside-only' }
      ),
      w = dom.window,
      frame = w.document.querySelector('iframe')!
    frame.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 140,
      bottom: 100,
      width: 140,
      height: 100,
      toJSON: () => {}
    })
    Object.defineProperty(frame, 'clientWidth', { value: 128 })
    Object.defineProperty(frame, 'clientHeight', { value: 98 })
    const { cdp } = fixture(true),
      dispatch = cdp.callTarget,
      metadata: any[] = []
    cdp.callTarget = async (target: any, method: string, params: any, options: any) => {
      if (method === 'Runtime.callFunctionOn' && params.objectId === 'frame') {
        const value = w.eval('(' + params.functionDeclaration + ')').call(frame)
        metadata.push(value)
        return { result: { value } }
      }
      return await dispatch(target, method, params, options)
    }
    const span = { currentPlaywrightOperation: () => 'locator' },
      api = original
        ? new base.BaselinePlaywright(cdp, {}, span, base.baselineCommandTiming, iab)
        : new PlaywrightSelectors(cdp as any, span, new CommandTiming(), iab)
    try {
      return JSON.parse(
        JSON.stringify({
          route: await api.frameRouteForFirstOopif(
            { target: { tabId: 1 }, oopifFrameChain: [] },
            'iframe >> internal:control=enter-frame >> button',
            { timeoutMs: 100 }
          ),
          metadata
        })
      )
    } finally {
      w.close()
    }
  }
  for (const iab of [false, true])
    expect(await exercise(false, iab)).toEqual(await exercise(true, iab))
})
