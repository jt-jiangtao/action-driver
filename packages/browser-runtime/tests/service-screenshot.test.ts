// @vitest-environment node
import { test, expect } from 'vitest'
import { captureTabScreenshot } from '../src/service-screenshot'
import { originalDocumentation } from './original-service'
test('screenshots preserve crop/full page/CSS/device scaling, fallback and credential observation', async () => {
  const base = await originalDocumentation()
  async function exercise(run: any, params: any, scale: string, stream: boolean, invalid: boolean) {
    const calls: any[] = [],
      cdp = {
        withInternalScreencast: async (_id: any, action: any) =>
          stream ? await action(() => true) : undefined,
        waitForEvent: async (_id: any, predicate: any) => {
          const event = {
            method: 'Page.screencastFrame',
            source: { tabId: 1 },
            params: { sessionId: 2, data: 'stream', metadata: { timestamp: Date.now() / 1000 + 1 } }
          }
          expect(predicate(event)).toBe(true)
          return event
        },
        call: async (...args: any[]) => {
          calls.push(args)
          switch (args[1]) {
            case 'Runtime.evaluate':
              return { result: { value: 2 } }
            case 'Page.getLayoutMetrics':
              return {
                cssContentSize: invalid ? { width: 0, height: 0 } : { width: 1000, height: 2000 },
                cssVisualViewport: { pageX: 3, pageY: 4, clientWidth: 500, clientHeight: 400 }
              }
            case 'Page.captureScreenshot':
              return { data: invalid ? '' : 'capture' }
            default:
              return {}
          }
        }
      }
    let result, error
    try {
      result = await run(
        { tab_id: '1', ...params },
        {
          cdp,
          credentialObservationGate: {
            observe: async (action: any, id: any) => {
              calls.push(['observe', id])
              return await action()
            }
          }
        },
        scale
      )
    } catch (e: any) {
      error = e.message
    }
    return { result, error, calls: calls.map((call) => JSON.parse(JSON.stringify(call))) }
  }
  for (const scale of ['css', 'device'])
    for (const params of [
      {},
      { fullPage: true },
      { cropX: 1, cropY: 2, cropWidth: 30, cropHeight: 40 },
      { cropX: 1, cropY: 2, cropWidth: 0, cropHeight: 40 }
    ])
      for (const stream of [false, true])
        for (const invalid of [false, true])
          expect(await exercise(captureTabScreenshot, params, scale, stream, invalid)).toEqual(
            await exercise(base.baselineScreenshot, params, scale, stream, invalid)
          )
})
test('stale screencast frames are acknowledged and stream is stopped on frame failure', async () => {
  const base = await originalDocumentation()
  async function exercise(run: any, fail: boolean) {
    const calls: any[] = [],
      cdp = {
        withInternalScreencast: async (_id: any, action: any) => await action(() => true),
        waitForEvent: async () => {
          const n = calls.filter((c) => c[1] === 'Page.screencastFrameAck').length
          if (fail && n === 1) throw Error('frame timeout')
          return {
            source: { tabId: 1 },
            method: 'Page.screencastFrame',
            params: {
              sessionId: n + 1,
              data: 'stream',
              metadata: { timestamp: n === 0 ? 0 : Date.now() / 1000 + 1 }
            }
          }
        },
        call: async (...args: any[]) => {
          calls.push(args)
          if (args[1] === 'Page.getLayoutMetrics')
            return {
              cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 500, clientHeight: 400 }
            }
          return { data: 'fallback' }
        }
      }
    return {
      result: await run({ tab_id: 1 }, { cdp }, 'device'),
      calls: JSON.parse(JSON.stringify(calls))
    }
  }
  for (const fail of [false, true])
    expect(await exercise(captureTabScreenshot, fail)).toEqual(
      await exercise(base.baselineScreenshot, fail)
    )
})
