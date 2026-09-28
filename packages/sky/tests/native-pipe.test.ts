// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { originalModule } from '../../cua/tests/original-module'
import { NativePipeTransport } from '../src/mac/native-pipe'
import { encodeMessageFrame, decodeMessageFrames } from '../src/mac/rpc-codec'
class Pipe extends EventEmitter {
  writes: unknown[] = []
  ended = false
  handler?: (message: any) => void
  write(bytes: Uint8Array) {
    const message = JSON.parse(decodeMessageFrames(Buffer.from(bytes)).messages[0]!)
    this.writes.push(message)
    this.handler?.(message)
  }
  end() {
    this.ended = true
    this.emit('close')
  }
  reply(value: unknown) {
    this.emit('data', encodeMessageFrame(JSON.stringify(value)))
  }
}
const input = {
  requestType: 'action',
  request: { app: 'TextEdit' },
  timeoutSeconds: 1,
  codexMetadata: new Uint8Array(Buffer.from('{"turn":1}'))
}
afterEach(() => vi.useRealTimers())
test('request envelope, metadata bytes, response fragmentation and serialization match original', async () => {
  const ref = await originalModule(
    resolve(
      'packages/back/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/mac/native-pipe.js'
    )
  )
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  async function exercise(Transport: any) {
    const pipe = new Pipe()
    const client = new Transport(pipe, 'version')
    const first = client.request(input)
    const second = client.request({ ...input, codexMetadata: { turn: 2 } })
    await Promise.resolve()
    expect(pipe.writes).toHaveLength(1)
    const frame = encodeMessageFrame(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'first' }))
    pipe.emit('data', frame.subarray(0, 5))
    pipe.emit('data', frame.subarray(5))
    expect(await first).toBe('first')
    await Promise.resolve()
    expect(pipe.writes).toHaveLength(2)
    pipe.reply({ jsonrpc: '2.0', id: 2, result: 'second' })
    expect(await second).toBe('second')
    pipe.end()
    return pipe.writes
  }
  expect(await exercise(NativePipeTransport)).toEqual(await exercise(ref.MacNativePipeTransport))
})
test('RPC server errors reject one request while queue remains usable', async () => {
  const pipe = new Pipe()
  const transport = new NativePipeTransport(pipe, 'v')
  pipe.handler = (m) =>
    queueMicrotask(() =>
      pipe.reply(
        m.id === 1
          ? { id: m.id, jsonrpc: '2.0', error: { code: -10006, message: 'blocked' } }
          : { id: m.id, jsonrpc: '2.0', result: 'ok' }
      )
    )
  await expect(transport.request(input)).rejects.toMatchObject({
    code: -10006,
    errorName: 'appNotAllowed',
    request: null,
    requestType: 'jsonRPC'
  })
  expect(await transport.request(input)).toBe('ok')
  pipe.end()
})
test('timeout ignores late response and allows following requests', async () => {
  vi.useFakeTimers()
  const pipe = new Pipe()
  const transport = new NativePipeTransport(pipe, 'v')
  const first = transport.request(input)
  const observed = expect(first).rejects.toThrow('request timed out')
  await vi.advanceTimersByTimeAsync(1000)
  await observed
  pipe.reply({ id: 1, jsonrpc: '2.0', result: 'late' })
  pipe.handler = (m) => queueMicrotask(() => pipe.reply({ id: m.id, jsonrpc: '2.0', result: 'ok' }))
  expect(await transport.request(input)).toBe('ok')
  pipe.end()
})
test.each(['bad JSON', 'both result and error', 'oversized'])(
  'invalid %s closes pipe and rejects pending request',
  async (invalid) => {
    const pipe = new Pipe()
    const transport = new NativePipeTransport(pipe, 'v')
    const pending = transport.request(input)
    const observed = expect(pending).rejects.toThrow()
    await Promise.resolve()
    if (invalid === 'bad JSON') pipe.emit('data', encodeMessageFrame('{'))
    else if (invalid === 'oversized') {
      const header = Buffer.alloc(4)
      header.writeUInt32LE(8388609)
      pipe.emit('data', header)
    } else pipe.reply({ id: 1, jsonrpc: '2.0', result: 1, error: { code: 1, message: 'x' } })
    await observed
    expect(transport.isClosed).toBe(true)
    expect(pipe.ended).toBe(true)
    await expect(transport.request(input)).rejects.toThrow('pipe is closed')
  }
)
test('close rejects pending and queued operations without dispatching queued request', async () => {
  const pipe = new Pipe()
  const transport = new NativePipeTransport(pipe, 'v')
  const first = transport.request(input),
    second = transport.request(input)
  const a = expect(first).rejects.toThrow('closed before response'),
    b = expect(second).rejects.toThrow('pipe is closed')
  await Promise.resolve()
  pipe.end()
  await Promise.all([a, b])
  expect(pipe.writes).toHaveLength(1)
})
test('ping verifies version and write failures clean pending timeout', async () => {
  const pipe = new Pipe()
  const transport = new NativePipeTransport(pipe, 'v')
  pipe.handler = (m) =>
    pipe.reply({ id: m.id, jsonrpc: '2.0', result: { serverApiVersion: 'wrong' } })
  await expect(transport.ping(100)).rejects.toThrow('API version mismatch: client=v server=wrong')
  pipe.write = () => {
    throw new Error('write failed')
  }
  await expect(transport.request(input)).rejects.toThrow('write failed')
  pipe.end()
})
