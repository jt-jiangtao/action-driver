// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { createNativeBrowserContext } from '../src/service-native-context'
import { FrameDecoder, encodeFrame } from '../src/service-native-pipe'
test('default native context connects framed socket, assembles session API, reuses and closes resources', async () => {
  const requests: any[] = [],
    decoder = new FrameDecoder()
  let endCount = 0,
    removed = 0,
    hook: any
  const socket = Object.assign(new EventEmitter(), {
    write: (frame: Buffer) => {
      for (const text of decoder.push(frame)) {
        const request = JSON.parse(text)
        requests.push(request)
        queueMicrotask(() =>
          socket.emit(
            'data',
            encodeFrame(
              JSON.stringify({
                id: request.id,
                result:
                  request.method === 'getInfo'
                    ? { type: 'extension', family: 'chrome' }
                    : request.method === 'getTabs'
                      ? [{ id: 1, url: 'https://example.com' }]
                      : 'done'
              })
            )
          )
        )
      }
    },
    end: () => {
      endCount++
      socket.emit('close')
    }
  })
  const host = {
    platform: 'darwin',
    env: {
      BROWSER_USE_BACKEND_PATHS: '/tmp/native',
      BROWSER_USE_TINYSKY_ENABLED: '0',
      BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1'
    },
    requestMeta: { 'x-codex-turn-metadata': { session_id: 'session', turn_id: 'turn' } },
    nativePipe: {
      createConnection: async (path: string) => {
        expect(path).toBe('/tmp/native')
        return socket
      }
    },
    addTurnEndedHandler: (value: any) => {
      hook = value
      return () => removed++
    }
  }
  const context = createNativeBrowserContext(host, {
    isFullCdpEnabled: async () => false,
    isWebMcpEnabled: async () => true
  })
  const first = await context.list(),
    api = first[0]!.api
  expect(await api.getTabs()).toEqual([{ id: 1, url: 'https://example.com' }])
  await context.refresh()
  expect((await context.list())[0]!.api).toBe(api)
  await hook.run({ session_id: 'session', turn_id: 'turn' })
  expect(requests.map((request) => request.method)).toEqual(['getInfo', 'getTabs', 'turnEnded'])
  expect(requests[1].params).toMatchObject({
    session_id: 'session',
    turn_id: 'turn',
    session_context: 'live'
  })
  await context.dispose()
  expect(endCount).toBe(1)
  expect(removed).toBe(1)
  expect(context.browsers).toBeNull()
})
test('default context refuses non-mac platforms before registering host hooks', () => {
  let hooks = 0
  expect(() =>
    createNativeBrowserContext(
      {
        platform: 'linux',
        env: {},
        addTurnEndedHandler: () => {
          hooks++
          return () => {}
        }
      },
      { isFullCdpEnabled: async () => false, isWebMcpEnabled: async () => true }
    )
  ).toThrow('Unsupported browser backend platform: linux')
  expect(hooks).toBe(0)
})
test('default session factory requires verified identity before enabling extension request headers', async () => {
  const requests: any[] = [],
    decoder = new FrameDecoder(),
    socket = Object.assign(new EventEmitter(), {
      write: (frame: Buffer) => {
        for (const text of decoder.push(frame)) {
          const request = JSON.parse(text)
          requests.push(request)
          queueMicrotask(() =>
            socket.emit(
              'data',
              encodeFrame(
                JSON.stringify({
                  id: request.id,
                  result: { type: 'extension', agentRequestHeaderEnabled: false }
                })
              )
            )
          )
        }
      },
      end: () => socket.emit('close')
    })
  const context = createNativeBrowserContext(
    {
      platform: 'darwin',
      env: { BROWSER_USE_BACKEND_PATHS: '/tmp/native', BROWSER_USE_TINYSKY_ENABLED: '0' },
      requestMeta: { 'x-codex-turn-metadata': { session_id: 'session', turn_id: 'turn' } },
      nativePipe: { createConnection: async () => socket },
      addTurnEndedHandler: () => () => {}
    },
    { isFullCdpEnabled: async () => false, isWebMcpEnabled: async () => true }
  )
  try {
    const [browser] = await context.list()
    await expect(browser!.api.getTabs()).rejects.toThrow(
      'Browser request-header policy requires caller identity.'
    )
    expect(requests.map((request) => request.method)).toEqual(['getInfo'])
  } finally {
    await context.dispose()
  }
})
