// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  waitForLoadState,
  waitForUrl,
  waitForNetworkIdle,
  urlPattern
} from '../src/service-page-waits'
import { originalDocumentation } from './original-service'
test('load and URL waits match initial readiness, main-frame filtering and wait-until behavior', async () => {
  const base = await originalDocumentation()
  for (const initial of [true, false]) {
    async function exercise(load: any, url: any) {
      const calls: any[] = []
      const cdp = {
        call: async (...args: any[]) => {
          calls.push(args)
          return { frameTree: { frame: { id: 'main' } } }
        },
        readDocumentState: async () => ({
          readyState: initial ? 'complete' : 'loading',
          href: initial ? 'https://example.com/a' : 'https://old.test'
        }),
        waitForEvent: async (_id: number, predicate: any, options: any) => {
          if (await options.initialCheck?.()) return
          const wrong = {
            source: { tabId: 1, sessionId: 'frame' },
            method: 'Page.frameNavigated',
            params: { frame: { id: 'main', url: 'https://example.com/a' } }
          }
          expect(predicate(wrong)).toBe(false)
          for (const event of [
            {
              source: { tabId: 1 },
              method: 'Page.frameNavigated',
              params: { frame: { id: 'other', url: 'https://example.com/a' } }
            },
            {
              source: { tabId: 1 },
              method: 'Page.frameNavigated',
              params: { frame: { id: 'main', url: 'https://example.com/a' } }
            },
            { source: { tabId: 1 }, method: 'Page.loadEventFired' }
          ])
            if (predicate(event)) return event
          throw Error(options.timeoutMessage)
        }
      }
      const context = { cdp }
      await load(1, 'load', 50, context)
      const result = await url(
        { tab_id: 1, url: 'https://example.com/*', wait_until: 'domcontentloaded', timeout_ms: 50 },
        context
      )
      return { calls, result }
    }
    expect(await exercise(waitForLoadState, waitForUrl)).toEqual(
      await exercise(base.baselineWaitLoad, base.baselineWaitUrl)
    )
  }
  for (const pattern of ['https://a/*', '**/a?x=[1]', 'a.b', '*', '**'])
    expect(urlPattern(pattern)).toBe(base.baselineUrlPattern(pattern))
})
test('network-idle follows document identity and releases listeners after success, detach or blocked navigation', async () => {
  const base = await originalDocumentation()
  for (const outcome of ['success', 'detach', 'blocked']) {
    async function exercise(run: any) {
      const emitter = new EventEmitter(),
        calls: any[] = []
      const cdp = Object.assign(emitter, {
        call: async (id: number, method: string, params: any, options: any) => {
          calls.push([id, method, params, { ...options, deadlineMs: 'deadline' }])
          if (method === 'Page.getFrameTree')
            return { frameTree: { frame: { id: 'main', loaderId: 'old' } } }
          if (method === 'Page.setLifecycleEventsEnabled')
            queueMicrotask(() => {
              emitter.emit('event', {
                source: { tabId: 1 },
                method: 'Page.lifecycleEvent',
                params: { frameId: 'main', loaderId: 'stale', name: 'networkIdle' }
              })
              if (outcome === 'detach') emitter.emit('tabDetached', 1)
              else if (outcome === 'blocked')
                emitter.emit('event', {
                  source: { tabId: 1 },
                  method: 'Page.navigationBlocked',
                  params: {
                    url: 'https://u:p@example.com/path?secret#hash',
                    resourceType: 'mainFrame'
                  }
                })
              else {
                emitter.emit('event', {
                  source: { tabId: 1 },
                  method: 'Page.frameNavigated',
                  params: { frame: { id: 'main', loaderId: 'new' } }
                })
                emitter.emit('event', {
                  source: { tabId: 1 },
                  method: 'Page.lifecycleEvent',
                  params: { frameId: 'main', loaderId: 'new', name: 'networkIdle' }
                })
              }
            })
        }
      })
      let error
      try {
        await run(cdp, 1, 100)
      } catch (e: any) {
        error = { name: e.name, message: e.message, reason: e.reason }
      }
      return {
        calls,
        error,
        listeners: emitter.listenerCount('event') + emitter.listenerCount('tabDetached')
      }
    }
    expect(await exercise(waitForNetworkIdle)).toEqual(await exercise(base.baselineNetworkIdle))
  }
})
test('network-idle timeout remains bounded and disposes listeners without matching lifecycle events', async () => {
  const base = await originalDocumentation()
  async function exercise(run: any) {
    const emitter = new EventEmitter(),
      cdp = Object.assign(emitter, {
        call: async (_id: number, method: string) =>
          method === 'Page.getFrameTree'
            ? { frameTree: { frame: { id: 'main', loaderId: 'one' } } }
            : undefined
      })
    let message
    try {
      await run(cdp, 1, 10)
    } catch (error: any) {
      message = error.message
    }
    return {
      message,
      listeners: emitter.listenerCount('event') + emitter.listenerCount('tabDetached')
    }
  }
  expect(await exercise(waitForNetworkIdle)).toEqual(await exercise(base.baselineNetworkIdle))
  expect((await exercise(waitForNetworkIdle)).message).toBe(
    'Timed out waiting for networkidle in tab 1.'
  )
})
