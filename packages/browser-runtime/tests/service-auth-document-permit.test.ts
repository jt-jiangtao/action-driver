// @vitest-environment node
import { expect, test } from 'vitest'
import { EventEmitter } from 'node:events'
import { createAuthRequestMatcher, createAuthOrdinaryUnsafeRequest, openAuthDocumentPermit,
  openAuthOrdinaryDocumentPermit } from '../src/service-auth-document-permit'

test('ordinary request guard blocks password in URL or referrer, including encoded forms', async () => {
  const unsafe = await createAuthOrdinaryUnsafeRequest('s+cret')
  expect(await unsafe({ url: 'https://example.com/', method: 'GET', headers: {} })).toBe(false)
  expect(await unsafe({ url: 'https://example.com/?p=s%2Bcret', method: 'GET', headers: {} })).toBe(true)
  expect(await unsafe({ url: 'https://example.com/', method: 'GET', headers: { Referer: 'https://example.com/?p=s+cret' } })).toBe(true)
  await expect(createAuthOrdinaryUnsafeRequest('')).rejects.toThrow('missing its password')
})

test('private credential POST matcher verifies named values without keeping raw values in comparisons', async () => {
  const matches = await createAuthRequestMatcher([
    { name: 'login', value: 'alice' }, { name: 'password', value: 'secret' }
  ])
  const request = (postData: string, type = 'application/x-www-form-urlencoded') => ({
    headers: { 'Content-Type': type }, postData
  })
  expect(await matches(request('login=alice&password=secret'))).toBe(true)
  expect(await matches(request('login=alice&password=wrong'))).toBe(false)
  expect(await matches(request('login=alice&login=alice&password=secret'))).toBe(false)
  expect(await matches(request('login=alice&password=secret', 'text/plain'))).toBe(false)
  expect(await matches(request('x='.repeat(70000)))).toBe(false)
})

test('private permit blocks cross-origin and unverified document POSTs, and closes leases', async () => {
  const operations: string[] = []
  let onRequest: ((request: any) => Promise<unknown>) | undefined
  const cdp = {
    on: () => {}, removeListener: () => {},
    suppressRawNetworkEvents: () => { operations.push('raw-protect'); return () => operations.push('raw-release') },
    protectBrowserAuthNewTargets: async () => { operations.push('targets-protect'); return async () => { operations.push('targets-release') } },
    protectServiceWorkerStarts: async () => { operations.push('workers-protect'); return async () => { operations.push('workers-release') } },
    protectBrowserAuthServiceWorkerBypass: async () => { operations.push('bypass-protect'); return async () => { operations.push('bypass-release') } },
    browserAuthNewTargetCheck: async () => 'contained',
    call: async (_id: number, method: string) => {
      operations.push(method)
      return method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'frame', securityOrigin: 'https://example.com' } } }
        : method === 'Page.createIsolatedWorld' ? { executionContextId: 12 }
          : method === 'Runtime.evaluate' ? { result: { value: true } }
            : { root: { localName: 'html', children: [] } }
    }
  }
  const requests = {
    on: () => {}, removeListener: () => {},
    addRequestInterceptor: async (_id: number, callback: typeof onRequest, priority: number) => {
      expect(priority).toBe(100)
      onRequest = callback
      return async () => { operations.push('interceptor-release') }
    }
  }
  const permit = await openAuthDocumentPermit({
    cdp, requests, tabId: 7, frameId: 'frame',
    target: { origin: 'https://example.com', url: 'https://example.com/login' },
    credentialFields: [{ name: 'login', value: 'alice' }, { name: 'password', value: 'secret' }]
  })
  expect(await onRequest!({ frameId: 'frame', resourceType: 'Document', networkId: 'n1', requestId: 'f1',
    request: { url: 'https://evil.example/login', method: 'POST', headers: {}, postData: '' } })).toBe('block')
  expect(await onRequest!({ frameId: 'frame', resourceType: 'Document', networkId: 'n2', requestId: 'f2',
    request: { url: 'https://example.com/login', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, postData: 'login=alice&password=wrong' } })).toBe('block')
  await permit.close()
  expect(operations).toContain('interceptor-release')
  expect(operations).toContain('raw-release')
  expect(operations).toContain('targets-release')
  expect(operations).toContain('workers-release')
  expect(operations).toContain('bypass-release')
})

test('private permit confirms only a released matching POST response and frame navigation', async () => {
  const cdpEvents = new EventEmitter()
  const requestEvents = new EventEmitter()
  let onRequest: (request: any) => Promise<unknown> = async () => 'block'
  const cdp = Object.assign(cdpEvents, {
    suppressRawNetworkEvents: () => () => {},
    protectBrowserAuthNewTargets: async () => async () => {},
    protectServiceWorkerStarts: async () => async () => {},
    protectBrowserAuthServiceWorkerBypass: async () => async () => {},
    browserAuthNewTargetCheck: async () => 'contained',
    call: async (_id: number, method: string) => method === 'Page.getFrameTree'
      ? { frameTree: { frame: { id: 'frame', securityOrigin: 'https://example.com' } } }
      : method === 'Page.createIsolatedWorld' ? { executionContextId: 12 }
        : method === 'Runtime.evaluate' ? { result: { value: true } }
          : { root: { localName: 'html', children: [] } }
  })
  const requests = Object.assign(requestEvents, {
    addRequestInterceptor: async (_id: number, callback: typeof onRequest) => {
      onRequest = callback
      return async () => {}
    }
  })
  const permit = await openAuthDocumentPermit({
    cdp, requests, tabId: 7, frameId: 'frame',
    target: { origin: 'https://example.com', url: 'https://example.com/login' },
    credentialFields: [{ name: 'login', value: 'alice' }, { name: 'password', value: 'secret' }]
  })
  const paused = { frameId: 'frame', resourceType: 'Document', networkId: 'n1', requestId: 'f1',
    request: { url: 'https://example.com/login', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, postData: 'login=alice&password=secret' } }
  expect(await onRequest(paused)).toBeUndefined()
  const redirect = { frameId: 'frame', resourceType: 'Document', requestId: 'f2',
    redirectedRequestId: 'f1', request: { url: 'https://example.com/account', method: 'GET', headers: {} } }
  expect(await onRequest(redirect)).toBeUndefined()
  cdpEvents.emit('event', { source: { tabId: 7 }, method: 'Network.requestWillBeSent', params: {
    requestId: 'n1', loaderId: 'loader', frameId: 'frame', type: 'Document',
    request: { url: 'https://example.com/login', method: 'POST' }
  } })
  cdpEvents.emit('event', { source: { tabId: 7 }, method: 'Network.responseReceived', params: {
    requestId: 'n1', loaderId: 'loader', frameId: 'frame', type: 'Document',
    response: { url: 'https://example.com/account', status: 200 }
  } })
  requestEvents.emit('requestResolution', 7, paused, 'released')
  cdpEvents.emit('event', { source: { tabId: 7 }, method: 'Page.frameNavigated', params: {
    frame: { id: 'frame', loaderId: 'loader', url: 'https://example.com/account' }
  } })
  expect(await permit.result(100)).toBe('submitted')
  await permit.close()
})

test('ordinary permit blocks cross-origin document before request and quiesces credentials', async () => {
  const methods: string[] = []
  let onRequest: (request: any) => Promise<unknown> = async () => undefined
  let blank = false
  const cdp = {
    on: () => {}, removeListener: () => {},
    suppressRawNetworkEvents: () => () => {},
    protectBrowserAuthServiceWorkerBypass: async () => async () => {},
    waitForEvent: async () => ({ method: 'Page.frameNavigated', params: {
      frame: { id: 'frame', url: 'about:blank' }
    } }),
    call: async (_id: number, method: string) => {
      methods.push(method)
      if (method === 'Page.navigate') { blank = true; return { frameId: 'frame', loaderId: 'blank-loader' } }
      if (method === 'Page.getFrameTree') return { frameTree: { frame: {
        id: 'frame', loaderId: blank ? 'blank-loader' : 'login-loader',
        url: blank ? 'about:blank' : 'https://example.com/login',
        securityOrigin: 'https://example.com'
      } } }
      return { root: { localName: 'html' } }
    }
  }
  const requests = {
    on: () => {}, removeListener: () => {},
    addRequestInterceptor: async (_id: number, callback: typeof onRequest) => {
      onRequest = callback
      return async () => {}
    }
  }
  const permit = await openAuthOrdinaryDocumentPermit({
    cdp, requests, tabId: 7, frameId: 'frame', origin: 'https://example.com', password: 'secret'
  })
  expect(await onRequest({ frameId: 'frame', resourceType: 'Document', requestId: 'f1',
    request: { url: 'https://evil.example/', method: 'GET', headers: {} } })).toBe('block')
  expect(await permit.ordinaryResult()).toBe('origin_changed')
  expect(methods).toContain('Page.stopLoading')
  expect(methods).toContain('Page.navigate')
  await permit.close()
})

test('ordinary permit releases interception even if blank navigation cleanup fails', async () => {
  const released: string[] = []
  let onRequest: (request: any) => Promise<unknown> = async () => undefined
  const cdp = {
    on: () => {}, removeListener: () => {},
    suppressRawNetworkEvents: () => () => released.push('raw'),
    protectBrowserAuthServiceWorkerBypass: async () => async () => { released.push('worker') },
    waitForEvent: async () => ({}),
    call: async (_id: number, method: string) => {
      if (method === 'Page.navigate') throw Error('navigation failed')
      return method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'frame', loaderId: 'login', securityOrigin: 'https://example.com' } } }
        : { root: { localName: 'html' } }
    }
  }
  const requests = { on: () => {}, removeListener: () => {},
    addRequestInterceptor: async (_id: number, callback: typeof onRequest) => {
      onRequest = callback
      return async () => { released.push('interceptor') }
    } }
  const permit = await openAuthOrdinaryDocumentPermit({
    cdp, requests, tabId: 7, frameId: 'frame', origin: 'https://example.com', password: 'secret'
  })
  expect(await onRequest({ frameId: 'frame', resourceType: 'Document', requestId: 'f',
    request: { url: 'http://example.com/', method: 'GET', headers: {} } })).toBe('block')
  await expect(permit.close()).rejects.toThrow('navigation failed')
  expect(released).toEqual(expect.arrayContaining(['raw', 'worker', 'interceptor']))
})
