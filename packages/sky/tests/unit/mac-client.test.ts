// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { resolve } from 'node:path'
import { originalModule } from '../../../cua/tests/original-module'
import { MacComputerUseClient } from '../../src/mac/client'
import type { NativeRequest, RequestTransport } from '../../src/mac/native-pipe'
const root = 'thirdparty/backup/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/mac'
function fixture() {
  const calls: NativeRequest[] = []
  const transport: RequestTransport = {
    isClosed: false,
    request: async (input) => {
      calls.push(input)
      return 'result'
    }
  }
  return { calls, transport }
}
async function reference(f: ReturnType<typeof fixture>, options = {}) {
  const ref = await originalModule(resolve(root, 'client.js'))
  const client = new (ref.MacComputerUseClient as any)(options)
  client.getTransport = async () => f.transport
  return client
}
async function exercise(client: any) {
  await client.listApps()
  await client.startAudioRecording({ maxDurationMilliseconds: 500 })
  await client.stopAudioRecording()
  await client.getAppPolicy('App')
  await client.startApp({ app: ' App ' })
  await client.getAppState({ app: 'App', disableDiff: false })
  await client.getAppState('App')
  await client.click({ app: 'App', elementIndex: 3 })
  await client.click({ app: 'App', x: 1, y: 2, clickCount: 2, mouseButton: ' R ' })
  await client.drag({ app: 'App', fromX: 1, fromY: 2, toX: 3, toY: 4 })
  await client.paste({ app: 'App', text: 'rich', format: 'html' })
  await client.performSecondaryAction({ app: 'App', elementIndex: -1, action: 'open' })
  await client.pressKey({ app: 'App', key: 'CMD+A' })
  await client.scroll({ app: 'App', elementIndex: 2, direction: ' D ' })
  await client.scroll({ app: 'App', x: 1, y: 2, direction: 'left', pages: 0.5 })
  await client.setValue({ app: 'App', elementIndex: 0, value: 'value' })
  await client.selectText({ app: 'App', elementIndex: 3, text: 'text' })
  await client.selectText({
    app: 'App',
    elementIndex: 3,
    text: 'text',
    prefix: 'p',
    suffix: 's',
    selection: 'all'
  })
  await client.typeText(
    { app: 'App', text: 'typed' },
    { apiVersion: 'override', timeoutSeconds: 9, codexMetadata: null }
  )
}
test('all observation/audio/action request shapes and defaults match original', async () => {
  const own = fixture(),
    ref = fixture()
  const defaults = { apiVersion: 'v', timeoutSeconds: 12, codexMetadata: { turn: 1 } }
  await exercise(
    new MacComputerUseClient({ ...defaults, createTransport: async () => own.transport })
  )
  await exercise(await reference(ref, defaults))
  expect(own.calls).toEqual(ref.calls)
})
test('validation rejects invalid app, target, key, mouse and scroll without dispatch', async () => {
  const own = fixture(),
    ref = fixture()
  const client = new MacComputerUseClient({ createTransport: async () => own.transport })
  const original = await reference(ref)
  const cases: [string, unknown][] = [
    ['startApp', ' '],
    ['click', { app: 'App', x: 1, y: Infinity }],
    ['click', { app: 'App', elementIndex: 1.5 }],
    ['click', { app: 'App', elementIndex: 1, mouseButton: 3 }],
    ['click', { app: 'App', elementIndex: 1, mouseButton: 'unknown' }],
    ['drag', { app: 'App', fromX: 0, fromY: 1, toX: NaN, toY: 1 }],
    ['pressKey', { app: 'App', key: ' ' }],
    ['scroll', { app: 'App', elementIndex: 1, direction: 'down', pages: 0 }],
    ['scroll', { app: 'App', elementIndex: 1, direction: 'bad' }]
  ]
  for (const [method, args] of cases) {
    let expected: unknown
    try {
      original[method](args)
    } catch (e) {
      expected = e
    }
    expect(() => Reflect.get(client, method).call(client, args)).toThrow(
      (expected as Error).message
    )
  }
  expect(own.calls).toEqual([])
})
test('transport creation is shared per API version and failed creation retries', async () => {
  const f = fixture()
  let fail = true
  const create = vi.fn(async () => {
    if (fail) {
      fail = false
      throw new Error('connect failed')
    }
    return f.transport
  })
  const client = new MacComputerUseClient({ createTransport: create })
  await expect(client.listApps()).rejects.toThrow('connect failed')
  await Promise.all([client.listApps(), client.listApps()])
  expect(create).toHaveBeenCalledTimes(2)
  await client.listApps({ apiVersion: 'other' })
  expect(create).toHaveBeenCalledTimes(3)
})
test('closed transport is discarded on failed request and replaced', async () => {
  const f = fixture()
  let closed = false
  const dead: RequestTransport = {
    get isClosed() {
      return closed
    },
    request: async () => {
      closed = true
      throw new Error('disconnected')
    }
  }
  const create = vi.fn().mockResolvedValueOnce(dead).mockResolvedValue(f.transport)
  const client = new MacComputerUseClient({ createTransport: create })
  await expect(client.listApps()).rejects.toThrow('disconnected')
  expect(await client.listApps()).toBe('result')
  expect(create).toHaveBeenCalledTimes(2)
})
test('per-call metadata overrides constructor and runtime fallback including null', async () => {
  const f = fixture()
  const client = new MacComputerUseClient({
    createTransport: async () => f.transport,
    getRequestMeta: () => ({ 'x-codex-turn-metadata': { turn: 1 } })
  })
  await client.listApps()
  await client.listApps({ codexMetadata: null })
  await client.listApps({ codexMetadata: { turn: 2 } })
  expect(f.calls.map((c) => c.codexMetadata)).toEqual([{ turn: 1 }, null, { turn: 2 }])
})
test('default client uses trusted runtime native transport and original default version', async () => {
  const { EventEmitter } = await import('node:events')
  const { decodeMessageFrames, encodeMessageFrame } = await import('../../src/mac/rpc-codec')
  const pipe = Object.assign(new EventEmitter(), {
    write(data: Uint8Array) {
      const m = JSON.parse(decodeMessageFrames(Buffer.from(data)).messages[0]!)
      queueMicrotask(() =>
        pipe.emit(
          'data',
          encodeMessageFrame(
            JSON.stringify({
              id: m.id,
              jsonrpc: '2.0',
              result: m.method === 'ping' ? { serverApiVersion: 'CodexComputerUseIPC-5' } : ['app']
            })
          )
        )
      )
    },
    end() {
      pipe.emit('close')
    }
  })
  const saved = Reflect.get(globalThis, 'nodeRepl')
  Reflect.set(globalThis, 'nodeRepl', { nativePipe: { createConnection: async () => pipe } })
  try {
    expect(await new MacComputerUseClient().listApps()).toEqual(['app'])
  } finally {
    pipe.end()
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', saved)
  }
})
test('constructor snapshots defaults when caller mutates options object', async () => {
  const own = fixture(),
    ref = fixture()
  const options = {
    apiVersion: 'v1',
    timeoutSeconds: 12,
    codexMetadata: { turn: 1 },
    createTransport: async () => own.transport
  }
  const client = new MacComputerUseClient(options),
    original = await reference(ref, options)
  options.apiVersion = 'v2'
  options.timeoutSeconds = 99
  options.codexMetadata = { turn: 2 }
  await client.listApps()
  await original.listApps()
  expect(own.calls).toEqual(ref.calls)
})
