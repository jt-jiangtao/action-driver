// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import { LocalCdpAdapter } from '../../../../src/main/browser-session/local-cdp-adapter'

test('correlates CDP calls and subscribed events by tab, cursor and method', async () => {
  const emitter = new EventEmitter()
  const session = Object.assign(emitter, {
    send: vi.fn(async () => ({ value: 1 })), detach: vi.fn(async () => {})
  })
  const adapter = new LocalCdpAdapter(session as never, 7)
  expect(await adapter.send('Runtime.evaluate', { expression: '1' })).toEqual({ value: 1 })
  const waiting = adapter.readEvents({ methods: ['Page.loadEventFired'], timeoutMs: 100 })
  emitter.emit('event', { method: 'Page.loadEventFired', params: { timestamp: 3 } })
  expect(await waiting).toEqual({
    cursor: 1, events: [{ sequence: 1, source: { tabId: 7 },
      method: 'Page.loadEventFired', params: { timestamp: 3 } }],
    hasMore: false, truncated: false
  })
  expect(await adapter.readEvents({ afterSequence: 1, methods: ['Page.loadEventFired'] }))
    .toEqual({ cursor: 1, events: [], hasMore: false, truncated: false })
  await adapter.close()
  expect(session.detach).toHaveBeenCalledOnce()
  expect(emitter.listenerCount('event')).toBe(0)
  await expect(adapter.send('Runtime.evaluate')).rejects.toThrow('BROWSER_CDP_CLOSED')
})

test('rejects pending event reads on detach without leaving listeners', async () => {
  const emitter = new EventEmitter()
  const session = Object.assign(emitter, {
    send: vi.fn(async () => ({})), detach: vi.fn(async () => {})
  })
  const adapter = new LocalCdpAdapter(session as never, 1)
  const waiting = adapter.readEvents({ methods: ['Page.frameNavigated'], timeoutMs: 1000 })
  await adapter.close()
  await expect(waiting).rejects.toThrow('BROWSER_CDP_CLOSED')
  expect(emitter.listenerCount('event')).toBe(0)
})
