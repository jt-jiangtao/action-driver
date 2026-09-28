// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PlaywrightWorlds } from '../src/service-playwright-worlds'
import { originalDocumentation } from './original-service'
test('helper installation caches target/frame worlds and recovers missing helper or destroyed frame context once', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean, frame: boolean, failure: string) {
    const calls: any[] = [],
      events = new EventEmitter()
    let context = 0,
      failed = false
    const cdp = Object.assign(events, {
      callTarget: async (target: any, method: string, params: any, options: any) => {
        const install =
          params.expression?.includes('new PlaywrightInjected.InjectedScript') === true
        calls.push([
          target,
          method,
          {
            ...params,
            expression: params.expression == null ? undefined : install ? 'install' : 'evaluate'
          },
          options
        ])
        if (method === 'Page.createIsolatedWorld') return { executionContextId: ++context }
        if (method === 'Runtime.releaseObject') return {}
        if (!install && !failed && failure) {
          failed = true
          if (failure === 'throw') throw Error('Execution context was destroyed')
          return {
            result: { objectId: 'value-object' },
            exceptionDetails: {
              exception: {
                description:
                  failure === 'missing'
                    ? 'Browser Use Playwright injected helper is missing'
                    : 'Execution context was destroyed',
                objectId: 'error-object'
              }
            }
          }
        }
        return { result: { value: install ? undefined : 'value' } }
      }
    })
    const api = original
        ? new base.BaselinePlaywright(cdp, {}, {}, {})
        : new PlaywrightWorlds(cdp as any),
      target = { tabId: 1 },
      options = {
        timeoutMs: 200,
        telemetryAttrs: { 'browser_use.playwright.operation': 'locator' }
      }
    let result, error
    try {
      result = await api.evaluateWithPlaywrightInjectedInTarget(
        target,
        '42',
        options,
        frame ? 'main' : undefined
      )
      await api.ensurePlaywrightInjectedInTarget(target, options, frame ? 'main' : undefined)
    } catch (e: any) {
      error = e.message
    }
    events.emit('event', { source: target, method: 'Runtime.executionContextsCleared', params: {} })
    await api.ensurePlaywrightInjectedInTarget(target, options, frame ? 'main' : undefined)
    events.emit('tabDetached', 1)
    return {
      result,
      error,
      worlds: [...api.playwrightFrameWorlds.keys()],
      installed: [...api.playwrightInjectedTargets],
      calls: calls.map((call) =>
        JSON.parse(JSON.stringify(call, (key, value) => (key === 'deadlineMs' ? undefined : value)))
      )
    }
  }
  for (const frame of [false, true])
    for (const failure of ['', 'missing', 'destroyed', 'throw'])
      expect(await exercise(false, frame, failure)).toEqual(await exercise(true, frame, failure))
})
test('frame world cache bounds and frame/target navigation invalidation match original', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const events = new EventEmitter(),
      cdp = Object.assign(events, { callTarget: async () => ({ executionContextId: 1 }) }),
      api = original
        ? new base.BaselinePlaywright(cdp, {}, {}, {})
        : new PlaywrightWorlds(cdp as any)
    for (let i = 0; i < 53; i++)
      await api.playwrightFrameWorld({ tabId: 1, sessionId: 'child' }, 'frame' + i)
    events.emit('event', {
      source: { tabId: 1, sessionId: 'child' },
      method: 'Page.frameDetached',
      params: { frameId: 'frame10' }
    })
    const count = api.playwrightFrameWorlds.size,
      keys = [...api.playwrightFrameWorlds.keys()]
    events.emit('event', {
      source: { tabId: 1, sessionId: 'child' },
      method: 'Target.attachedToTarget',
      params: {}
    })
    return { count, keys, after: api.playwrightFrameWorlds.size }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('expired selector deadlines reject before helper installation', async () => {
  const calls: any[] = [],
    cdp = Object.assign(new EventEmitter(), {
      callTarget: async (...args: any[]) => {
        calls.push(args)
        return {}
      }
    })
  await expect(
    new PlaywrightWorlds(cdp as any).ensurePlaywrightInjected(1, { deadlineMs: Date.now() - 1 })
  ).rejects.toThrow('selector deadline exceeded')
  expect(calls).toEqual([])
})
