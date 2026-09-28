// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { DocumentResponses } from '../src/service-document-responses'
import { originalDocumentation } from './original-service'
function fixture(Type: any) {
  const cdp: any = new EventEmitter(),
    calls: any[] = []
  cdp.addTabAttachHandler = () => () => {}
  cdp.isTabAttached = () => true
  cdp.call = async (...args: any[]) => calls.push(args)
  const responses = new Type(cdp)
  return { cdp, calls, responses }
}
test('document responses continue or retain claimed interception with owned response state', async () => {
  const base = await originalDocumentation()
  for (const claim of [true, false])
    for (const modify of [true, false])
      for (const failure of [true, false]) {
        async function exercise(Type: any) {
          const f = fixture(Type),
            response = {
              source: { tabId: 1 },
              method: 'Fetch.requestPaused',
              params: {
                requestId: 'request',
                resourceType: 'Document',
                responseStatusCode: 200,
                responseStatusText: 'OK',
                responseHeaders: [{ name: 'initial', value: 'value' }],
                ...(failure ? { responseErrorReason: 'Failed' } : {})
              }
            }
          f.responses.on('intercept', (_id: any, _params: any, take: any) => {
            if (claim) take()
          })
          f.responses.on('response', (_id: any, params: any) => {
            if (modify) params.responseHeaders = [{ name: 'new', value: 'value' }]
          })
          await f.responses.handleEvent(response)
          const retained = f.responses.hasOwnedPausedResponses(1)
          if (retained) await f.responses.failResponse(1, 'request')
          return { calls: f.calls, retained, after: f.responses.hasOwnedPausedResponses(1) }
        }
        expect(await exercise(DocumentResponses)).toEqual(
          await exercise(base.BaselineDocumentResponses)
        )
      }
})
test('request interceptors honor priority, fail closed on exceptions and report resolution', async () => {
  const base = await originalDocumentation()
  for (const outcome of ['continue', 'block', 'handled', 'throw']) {
    async function exercise(Type: any) {
      const f = fixture(Type)
      f.responses.on('requestResolution', (...args: any[]) => f.calls.push(['resolved', ...args]))
      const remove = await f.responses.addRequestInterceptor(
        1,
        async () => {
          f.calls.push('low')
          return 'continue'
        },
        1
      )
      await f.responses.addRequestInterceptor(
        1,
        async () => {
          f.calls.push('high')
          if (outcome === 'throw') throw Error('failed')
          return outcome
        },
        2
      )
      await f.responses.handleEvent({
        source: { tabId: 1 },
        method: 'Fetch.requestPaused',
        params: { requestId: 'request', resourceType: 'Image' }
      })
      await remove()
      await remove()
      return f.calls
    }
    expect(await exercise(DocumentResponses)).toEqual(
      await exercise(base.BaselineDocumentResponses)
    )
  }
})
test('request configuration serializes concurrent additions/removals and tab detach clears state', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = fixture(Type),
      [first, second] = await Promise.all([
        f.responses.addRequestInterceptor(1, async () => {}),
        f.responses.addRequestInterceptor(1, async () => {})
      ])
    await Promise.all([first(), second()])
    f.cdp.emit('tabDetached', 1)
    return {
      calls: f.calls,
      setup: f.responses.setupByTab.size,
      configured: f.responses.configuredRequestsByTab.size,
      pending: f.responses.configurationByTab.size
    }
  }
  expect(await exercise(DocumentResponses)).toEqual(await exercise(base.BaselineDocumentResponses))
})
