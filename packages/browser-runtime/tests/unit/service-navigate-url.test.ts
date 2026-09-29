// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { navigateTabUrl } from '../../src/service-navigate-url'
import { BrowserUseSecurityError } from '../../src/service-security-approval'
import { originalDocumentation } from '../original-service'
test('URL navigation preserves successful document permits, redacted browser errors and session changes', async () => {
  const base = await originalDocumentation()
  for (const mode of ['success', 'same', 'error', 'session', 'blocked', 'deny', 'changed']) {
    async function exercise(original: boolean) {
      const calls: any[] = [],
        events = new EventEmitter(),
        old = { id: 'main', loaderId: 'old', url: 'https://old.test/' },
        url = 'https://user:pass@example.com/page?secret=1#hash'
      let frame = { ...old },
        session = 'first',
        rejectApproval: (e: any) => void = () => {},
        resolveWait: (e: any) => void = () => {},
        rejectWait: (e: any) => void = () => {},
        predicate: (e: any) => boolean = () => false
      const cdp = Object.assign(events, {
        readDocumentState: async () => ({ href: old.url }),
        waitForEvent: (_id: any, test: any, options: any) => {
          predicate = test
          return new Promise((resolve, reject) => {
            resolveWait = resolve
            rejectWait = reject
            options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })
          })
        },
        call: async (id: any, method: any, params: any, options: any) => {
          calls.push([method, params])
          if (method === 'Page.getFrameTree') return { frameTree: { frame } }
          if (method === 'Page.getNavigationHistory')
            return { currentIndex: 0, entries: [{ id: 4, url: old.url }] }
          if (method === 'Page.navigate') {
            if (mode === 'session') session = 'second'
            options?.beforeDispatch?.()
            if (mode === 'error') return { frameId: 'main', errorText: 'Unable to open ' + url }
            const same = mode === 'same',
              next = same ? { ...old, url } : { id: 'main', loaderId: 'new', url }
            frame = next
            const dispatch = (method: string, params: any) => {
              const e = { source: { tabId: 1 }, method, params }
              events.emit('event', e)
              if (predicate(e)) resolveWait(e)
            }
            if (same) dispatch('Page.navigatedWithinDocument', { frameId: 'main', url })
            else {
              dispatch('Page.frameNavigated', { frame: next })
              dispatch(mode === 'blocked' ? 'Page.navigationBlocked' : 'Page.loadEventFired', {
                url,
                resourceType: 'mainFrame'
              })
            }
            if (mode === 'changed') {
              frame = { id: 'main', loaderId: 'third', url: 'https://other.test' }
              events.emit('event', {
                source: { tabId: 1 },
                method: 'Page.frameNavigated',
                params: { frame }
              })
            }
            if (mode === 'deny' || mode === 'changed')
              setImmediate(() => rejectApproval(securityError))
            return { frameId: 'main', ...(same ? {} : { loaderId: 'new' }) }
          }
          if (method === 'Page.stopLoading') options?.beforeDispatch?.()
          if (method === 'Page.navigateToHistoryEntry') {
            options?.beforeDispatch?.()
            const e = {
              source: { tabId: 1 },
              method: 'Page.navigatedWithinDocument',
              params: { frameId: 'main', url: old.url }
            }
            if (predicate(e)) resolveWait(e)
          }
          return {}
        }
      })
      const securityError = new (original ? base.BaselineSecurityError : BrowserUseSecurityError)(
        'browser_navigation_blocked',
        'permission denied'
      )
      const approval =
        mode === 'deny' || mode === 'changed'
          ? new Promise((_, reject) => {
              rejectApproval = reject
            })
          : Promise.resolve()
      approval.catch(() => {})
      const context = {
        cdp,
        documentResponses: {},
        followSessionTab: async (id: any) => {
          calls.push(['follow', id])
        },
        getCurrentSessionId: () => session,
        security: {
          ensureCommandAllowed: async (input: any) => {
            calls.push(['restoreApproval', input])
          }
        },
        credentialObservationGate: {
          epoch: 7,
          permitNavigatedDocument: (...args: any[]) => calls.push(['permit', ...args])
        }
      }
      let result, error
      try {
        result = await (original ? base.baselineNavigateUrl : navigateTabUrl)(
          { tab_id: '1', url, timeout_ms: 30 },
          context,
          approval
        )
      } catch (e: any) {
        error = { name: e.name, message: e.message }
      }
      rejectWait(Error('settle'))
      return {
        result,
        error,
        calls,
        listeners: events.listenerCount('event') + events.listenerCount('tabDetached')
      }
    }
    const actual = await exercise(false),
      expected = await exercise(true)
    expect(actual, mode).toEqual(expected)
    if (mode === 'success') expect(actual.calls).toContainEqual(['permit', 1, 'new', 7])
    if (mode === 'deny')
      expect(actual.calls.some((c) => c[0] === 'Page.navigateToHistoryEntry')).toBe(true)
    if (mode === 'changed')
      expect(actual.calls.some((c) => c[0] === 'Page.navigateToHistoryEntry')).toBe(false)
  }
})
test('navigation timeout releases listeners and aborts its outstanding event wait', async () => {
  const base = await originalDocumentation()
  async function exercise(run: any) {
    const events = new EventEmitter(),
      calls: string[] = [],
      frame = { id: 'main', loaderId: 'old', url: 'https://old.test' }
    let aborted = false
    const cdp = Object.assign(events, {
      readDocumentState: async () => ({ href: frame.url }),
      call: async (_id: number, method: string, _params: any, options: any) => {
        calls.push(method)
        options?.beforeDispatch?.()
        return method === 'Page.getFrameTree'
          ? { frameTree: { frame } }
          : method === 'Page.getNavigationHistory'
            ? { currentIndex: 0, entries: [] }
            : method === 'Page.navigate'
              ? { frameId: 'main', loaderId: 'new' }
              : {}
      },
      waitForEvent: (_id: number, _predicate: any, options: any) =>
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(Error(options.timeoutMessage)), options.timeoutMs)
          options.signal.addEventListener(
            'abort',
            () => {
              aborted = true
              clearTimeout(timer)
              reject(Error('aborted'))
            },
            { once: true }
          )
        })
    })
    let message
    try {
      await run(
        { tab_id: 1, url: 'https://example.com', timeout_ms: 5 },
        {
          cdp,
          documentResponses: {},
          followSessionTab: async () => {},
          getCurrentSessionId: () => 'session'
        },
        Promise.resolve()
      )
    } catch (e: any) {
      message = e.message
    }
    return {
      message,
      calls,
      aborted,
      listeners: events.listenerCount('event') + events.listenerCount('tabDetached')
    }
  }
  expect(await exercise(navigateTabUrl)).toEqual(await exercise(base.baselineNavigateUrl))
})
test('owned auth documents await permission before browser-blank navigation and unregister safely', async () => {
  const { registerAuthDocument, closeAuthDocument } = await import('../../src/service-navigate-url'),
    responses = {},
    calls: string[] = []
  const unregister = registerAuthDocument(responses, 1, {
    close: async () => {
      calls.push('close')
    },
    navigateToBrowserBlank: async () => {
      calls.push('blank')
    }
  })
  await closeAuthDocument(responses, 1)
  const cdp = Object.assign(new EventEmitter(), {
    readDocumentState: async () => {
      throw Error('after blank')
    }
  })
  const denied = Promise.reject(Error('permission denied'))
  denied.catch(() => {})
  await expect(
    navigateTabUrl(
      { tab_id: 1, url: 'https://example.com' },
      {
        cdp: cdp as any,
        documentResponses: responses,
        followSessionTab: async () => {
          calls.push('follow')
        },
        getCurrentSessionId: () => 'session',
        security: {} as any
      },
      denied
    )
  ).rejects.toThrow('permission denied')
  expect(calls).toEqual(['close', 'follow'])
  await expect(
    navigateTabUrl(
      { tab_id: 1, url: 'https://example.com' },
      {
        cdp: cdp as any,
        documentResponses: responses,
        followSessionTab: async () => {},
        getCurrentSessionId: () => 'session',
        security: {} as any
      },
      Promise.resolve()
    )
  ).rejects.toThrow('after blank')
  expect(calls).toEqual(['close', 'follow', 'blank'])
  unregister()
  await closeAuthDocument(responses, 1)
  expect(calls).toEqual(['close', 'follow', 'blank'])
})
