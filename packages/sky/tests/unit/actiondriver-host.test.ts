// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createActionDriverSky } from '../../src/mac/actiondriver-host'

test('maps app listing, state with screenshot, and click through owned helper requests', async () => {
  const requests: unknown[] = []
  const host = { request: vi.fn(async (input: any) => {
    requests.push(input)
    if (input.operation === 'list-apps') return { apps: [{ id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true }] }
    if (input.operation === 'app-state') return {
      app: 'com.apple.TextEdit', text: 'window',
      screenshot: { mimeType: 'image/png', base64: 'AQID' }
    }
    return { accepted: true }
  }) }
  vi.stubGlobal('nodeRepl', { nativePipe: { createConnection: vi.fn(() => { throw Error('private pipe') }) } })
  try {
    const sky = createActionDriverSky(host, { sessionId: 'test-session', requestId: (() => {
      let id = 0
      return () => `request-${++id}`
    })(), now: () => 1000 })
    expect(await sky.list_apps()).toEqual([{ id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true }])
    expect(await sky.get_app_state({ app: 'com.apple.TextEdit' })).toEqual({
      app: 'com.apple.TextEdit', text: 'window', screenshot: { url: 'data:image/png;base64,AQID' }
    })
    await sky.click({ app: 'com.apple.TextEdit', element_index: 2 })
    await sky.close()
    expect(requests.map((item: any) => item.operation)).toEqual([
      'list-apps', 'session-start', 'app-state', 'act', 'session-end'
    ])
    expect(requests[2]).toMatchObject({ sessionId: 'test-session', app: 'com.apple.TextEdit', screenshot: true })
    expect(requests[3]).toMatchObject({ action: { type: 'click-element', elementIndex: 2, mouseButton: 'left', clickCount: 1 } })
  } finally {
    vi.unstubAllGlobals()
  }
})

test('propagates helper permission errors, cancellation and closes once', async () => {
  const denied = new Error('ACCESSIBILITY_DENIED: enable permission')
  const host = { request: vi.fn(async (input: any, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('CANCELLED: request aborted')
    if (input.operation === 'app-state') throw denied
    return { accepted: true }
  }) }
  const abort = new AbortController()
  const sky = createActionDriverSky(host, { sessionId: 's', signal: abort.signal })
  await expect(sky.get_app_state({ app: 'TextEdit' })).rejects.toBe(denied)
  abort.abort()
  await expect(sky.click({ app: 'TextEdit', x: 1, y: 2 })).rejects.toThrow('CANCELLED')
  await sky.close()
  await sky.close()
  await expect(sky.list_apps()).rejects.toThrow('SKY_HOST_CLOSED')
  expect(host.request.mock.calls.filter(([input]) => input.operation === 'session-end')).toHaveLength(1)
})

test('unsupported Sky capabilities reject explicitly without private service fallback', async () => {
  const host = { request: vi.fn(async () => ({})) }
  const sky = createActionDriverSky(host, { sessionId: 's' })
  await expect(sky.start_audio_recording()).rejects.toThrow('SKY_CAPABILITY_UNAVAILABLE')
  expect(host.request).not.toHaveBeenCalled()
})

test('closing during an in-flight session start blocks new actions and ends the session', async () => {
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  const operations: string[] = []
  const host = { request: vi.fn(async (input: any) => {
    operations.push(input.operation)
    if (input.operation === 'session-start') await pending
    if (input.operation === 'app-state') return { app: 'TextEdit', text: 'state' }
    return { accepted: true }
  }) }
  const sky = createActionDriverSky(host, { sessionId: 's' })
  const state = sky.get_app_state({ app: 'TextEdit' })
  await vi.waitFor(() => expect(operations).toContain('session-start'))
  const closing = sky.close()
  await expect(sky.click({ app: 'TextEdit', x: 1, y: 2 })).rejects.toThrow('SKY_HOST_CLOSED')
  release!()
  await closing
  await expect(state).rejects.toThrow('SKY_HOST_CLOSED')
  expect(operations).toEqual(['session-start', 'session-end'])
})
