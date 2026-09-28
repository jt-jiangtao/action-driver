// @vitest-environment node
import { test, expect } from 'vitest'
import { VisibleDomSnapshot } from '../src/service-visible-dom'
import { DomSnapshotState } from '../src/service-dom-state'
import { originalDocumentation } from './original-service'
test('visible snapshots merge main and child frame refs with isolated worlds and release frame objects', async () => {
  const base = await originalDocumentation()
  async function exercise(
    original: boolean,
    reviewer: boolean,
    failChild: boolean,
    priority: boolean
  ) {
    const calls: any[] = [],
      contexts = new Map<number, string>()
    let next = 0
    const captures = new Set<string>(),
      viewport = { left: 0, top: 0, right: 500, bottom: 400 }
    let cleanup: (id: number) => void = () => {}
    const cdp = {
      addTabCleanupHandler: (callback: any) => {
        cleanup = callback
      },
      call: async (...args: any[]) => {
        calls.push(args)
        return { frameTree: { frame: { id: 'main', loaderId: 'loader' } } }
      },
      targetForFrameOrAttach: async (...args: any[]) => {
        calls.push(['target', ...args])
        return { tabId: 1, sessionId: 'child-session' }
      },
      callTarget: async (target: any, method: string, params: any, options: any) => {
        calls.push([
          target,
          method,
          { ...params, expression: params.expression == null ? undefined : 'page-code' },
          options
        ])
        if (method === 'Page.createIsolatedWorld') {
          contexts.set(++next, params.frameId)
          return { executionContextId: next }
        }
        if (method === 'DOM.describeNode') return { node: { frameId: 'child' } }
        if (method === 'Runtime.releaseObject') return {}
        if (method === 'Runtime.evaluate') {
          if (params.returnByValue === false) return { result: { objectId: 'iframe' } }
          const child = contexts.get(params.contextId) === 'child'
          if (child && failChild) throw Error('frame gone')
          return {
            result: {
              value: {
                viewport,
                items: [
                  {
                    ref: '1',
                    line: child
                      ? '<button node_id=1>Child</button>'
                      : '<button node_id=1>Main</button>'
                  }
                ],
                frameElements: child
                  ? []
                  : [
                      {
                        ref: '2',
                        rect: { left: 50, top: 60, right: 150, bottom: 160 },
                        size: { width: 100, height: 100 },
                        url: 'https://child.test'
                      }
                    ]
              }
            }
          }
        }
        return {}
      }
    }
    const state = new DomSnapshotState(),
      snapshot = new VisibleDomSnapshot(cdp as any, state)
    const result = original
      ? await base.baselineVisibleSnapshot(1, cdp, {
          ...(reviewer ? { reviewer: { capturedFrameIds: captures, nextNodeId: 1 } } : {}),
          ...(priority ? { credentialFrameId: 'child' } : {})
        })
      : await snapshot.get(1, {
          ...(reviewer ? { reviewer: { capturedFrameIds: captures, nextNodeId: 1 } } : {}),
          ...(priority ? { credentialFrameId: 'child' } : {})
        })
    if (!original && !reviewer) {
      expect(state.lookup(1, '1').frameId).toBe('main')
      if (!failChild) expect(state.lookup(1, '2').frameId).toBe('child')
    }
    cleanup(1)
    return {
      result,
      captures: [...captures],
      calls: calls.map((call) =>
        JSON.parse(
          JSON.stringify(call, (key, value) =>
            ['timeoutMs', 'deadlineMs', 'timeout'].includes(key) ? undefined : value
          )
        )
      )
    }
  }
  for (const reviewer of [false, true])
    for (const fail of [false, true])
      for (const priority of [false, true])
        expect(await exercise(false, reviewer, fail, priority)).toEqual(
          await exercise(true, reviewer, fail, priority)
        )
})
test('invalid page snapshot yields empty result while main frame evaluation errors propagate', async () => {
  const base = await originalDocumentation()
  for (const error of [false, true]) {
    async function exercise(original: boolean) {
      const cdp = {
        addTabCleanupHandler: () => {},
        call: async () => ({ frameTree: { frame: { id: 'main' } } }),
        callTarget: async (_target: any, method: string) =>
          method === 'Page.createIsolatedWorld'
            ? { executionContextId: 1 }
            : error
              ? { exceptionDetails: { exception: { description: 'page failed' } } }
              : { result: { value: { items: 'invalid' } } }
      }
      try {
        return {
          value: original
            ? await base.baselineVisibleSnapshot(1, cdp)
            : await new VisibleDomSnapshot(cdp as any).get(1)
        }
      } catch (e: any) {
        return { error: e.message }
      }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
