// @vitest-environment node
import { test, expect } from 'vitest'
import { CdpFrames } from '../../src/service-cdp-frames'
import { originalDocumentation } from '../original-service'
async function fixture(original: boolean) {
  const base = await originalDocumentation(),
    calls: any[] = [],
    api = {
      addEventListener: () => () => {},
      attach: async () => {},
      detach: async () => {},
      attachTarget: async (...args: any[]) => calls.push(['attach target', ...args]),
      detachTarget: async (...args: any[]) => calls.push(['detach target', ...args]),
      executeCdp: async (params: any) => {
        calls.push(params)
        return params.method === 'Page.getFrameTree'
          ? { frameTree: { frame: { id: 'frame' } } }
          : {}
      },
      executeCdpWithCachedExpression: async () => ({})
    },
    span = {
      currentCommandAttrs: () => ({}),
      withSpan: async (_n: any, _a: any, run: any) => run()
    },
    cdp = original ? new base.BaselineCdp(api, 'darwin', span) : new CdpFrames(api, span)
  if (original) {
    cdp.tabAttachHandlers.clear()
    cdp.tabCleanupHandlers.clear()
  }
  return { calls, cdp }
}
test('frame attachment initializes once, resolves aliases and cleans all attached frame targets', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      first = await f.cdp.attachDebuggerFrameTarget(1, 'target', 'frame', {}),
      second = await f.cdp.attachDebuggerFrameTarget(1, 'target', 'alias', {}),
      target = f.cdp.targetForFrame(1, 'alias'),
      id = f.cdp.targetIdForFrame(1, 'target')
    await f.cdp.detachAttachedFrameTargets(1)
    f.cdp.deleteFrameSessionsForTab(1)
    return {
      first,
      second,
      target,
      id,
      calls: f.calls,
      sessions: f.cdp.frameSessionsBySessionId.size,
      frames: f.cdp.frameSessionsByTabId.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('target events track supported targets, frame remapping and detachment', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original),
      results = []
    for (const type of ['worker', 'iframe'])
      f.cdp.handleAttachedToTarget({
        source: { tabId: 1 },
        method: 'Target.attachedToTarget',
        params: { sessionId: 'session', targetInfo: { type, targetId: 'target' } }
      })
    results.push(f.cdp.targetForFrame(1, 'target'))
    f.cdp.handleFrameNavigated({
      source: { tabId: 1, sessionId: 'session' },
      method: 'Page.frameNavigated',
      params: { frame: { id: 'frame' } }
    })
    results.push(f.cdp.targetForFrame(1, 'frame'))
    f.cdp.handleFrameNavigated({
      source: { tabId: 1, sessionId: 'session' },
      method: 'Page.frameNavigated',
      params: { frame: { id: 'child', parentId: 'frame' } }
    })
    results.push(f.cdp.targetForFrame(1, 'child'))
    f.cdp.handleDetachedFromTarget({ source: { tabId: 1 }, params: { sessionId: 'session' } })
    return {
      results,
      frames: [...f.cdp.frameSessionsByTabId].map(([id, map]: any) => [id, map.size]),
      sessions: f.cdp.frameSessionsBySessionId.size
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('concurrent frame initialization shares transport commands and failed initialization can retry', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    f.cdp.handleAttachedToTarget({
      source: { tabId: 1 },
      params: { sessionId: 'session', targetInfo: { type: 'iframe', targetId: 'target' } }
    })
    const frame = f.cdp.frameSessionsBySessionId.get('session')
    await Promise.all([
      f.cdp.initializeAttachedFrameSession(frame),
      f.cdp.initializeAttachedFrameSession(frame)
    ])
    await f.cdp.initializeAttachedFrameSession(frame)
    return {
      calls: f.calls,
      target: f.cdp.targetForFrame(1, 'frame'),
      pending: f.cdp.frameSessionInitializationPromises.has(frame)
    }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('cross-tab target ownership and unsupported attach targets return null', async () => {
  async function exercise(original: boolean) {
    const f = await fixture(original)
    await f.cdp.attachDebuggerFrameTarget(1, 'target', 'frame', {})
    const cross = await f.cdp.attachDebuggerFrameTarget(2, 'target', undefined, {})
    f.cdp.api.attachTarget = undefined
    const unavailable = await f.cdp.attachDebuggerFrameTarget(1, 'other', undefined, {})
    return { cross, unavailable, invalid: f.cdp.targetForFrame('bad', 'frame') }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('frame target lookup uses exact ids or unique URL matches and verifies parent ownership', async () => {
  for (const targets of [
    [{ type: 'iframe', targetId: 'target', tabId: 1, url: 'https://frame.example' }],
    [{ type: 'other', targetId: 'target', url: 'https://frame.example' }],
    [{ type: 'iframe', targetId: 'target', tabId: 2, url: 'https://frame.example' }],
    [
      { type: 'iframe', targetId: 'a', url: 'https://frame.example' },
      { type: 'iframe', targetId: 'b', url: 'https://frame.example' }
    ]
  ])
    for (const owner of [true, false]) {
      async function exercise(original: boolean) {
        const f = await fixture(original)
        f.cdp.api.executeCdp = async (params: any) => {
          f.calls.push(params)
          return params.method === 'Target.getTargets'
            ? { targetInfos: targets }
            : params.method === 'DOM.getFrameOwner'
              ? owner
                ? { backendNodeId: 1 }
                : {}
              : params.method === 'Page.getFrameTree'
                ? { frameTree: { frame: { id: 'frame' } } }
                : {}
        }
        const result = await f.cdp.targetForFrameOrAttach(
          1,
          undefined,
          {},
          { url: 'https://frame.example' }
        )
        return { result, calls: f.calls }
      }
      expect(await exercise(false)).toEqual(await exercise(true))
    }
})
