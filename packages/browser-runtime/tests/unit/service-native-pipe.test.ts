// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { NativeMessagePipe, FrameDecoder, encodeFrame } from '../../src/service-native-pipe'
import { originalDocumentation } from '../original-service'
async function compare(exercise: (Pipe: any, Decoder: any, encode: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  expect(await exercise(NativeMessagePipe, FrameDecoder, encodeFrame)).toEqual(
    await exercise(base.BaselineNativePipe, base.BaselineFrameDecoder, base.baselineEncodeFrame)
  )
}
test('native frames preserve UTF8 and decode arbitrary splits and coalesced frames', async () => {
  await compare(async (_Pipe, Decoder, encode) => {
    const frame = Buffer.concat([encode('你好'), encode(''), encode('abc')]),
      outputs = []
    for (let split = 0; split <= frame.length; split++) {
      const decoder = new Decoder()
      outputs.push([
        ...decoder.push(frame.subarray(0, split)),
        ...decoder.push(frame.subarray(split))
      ])
    }
    return { outputs, bytes: [...frame] }
  })
})
test('native frame limits and single-response checks match original', async () => {
  await compare(async (_Pipe, Decoder, encode) => {
    const errors: any[] = []
    for (const run of [
      () => encode('1234', 3),
      () => new Decoder(3).push(encode('1234')),
      () => new Decoder(undefined, true).push(Buffer.concat([encode('a'), encode('b')])),
      () => {
        const decoder = new Decoder(undefined, true)
        decoder.push(encode('a'))
        decoder.push(Buffer.from([0]))
      }
    ])
      try {
        run()
      } catch (e: any) {
        errors.push({
          message: e.message,
          messageBytes: e.messageBytes,
          maxFrameBytes: e.maxFrameBytes
        })
      }
    return errors
  })
})
function socket() {
  const writes: Buffer[] = []
  return Object.assign(new EventEmitter(), {
    writes,
    ends: 0,
    write(data: Buffer) {
      writes.push(data)
    },
    end() {
      this.ends++
    }
  })
}
test('native message transport receives decoded messages and closes once with settled listeners', async () => {
  await compare(async (Pipe, _Decoder, encode) => {
    const raw = socket(),
      pipe = new Pipe(raw, { decodeMessage: (value: any) => (value.skip ? undefined : value) }),
      messages: any[] = [],
      closed: any[] = []
    pipe.setMessageCallback((value: any) => messages.push(value))
    pipe.addCloseListener(async (error: any) => {
      closed.push(error?.message)
      throw Error('listener')
    })
    pipe.sendMessage({ hello: '世界' })
    raw.emit('data', Buffer.concat([encode('{"a":1}'), encode('{"skip":true}')]))
    await pipe.close(Error('stop'))
    await pipe.close(Error('again'))
    pipe.addCloseListener((error: any) => closed.push(['late', error?.message]))
    await Promise.resolve()
    await Promise.resolve()
    let error
    try {
      pipe.sendMessage({})
    } catch (e: any) {
      error = e.message
    }
    return {
      messages,
      closed,
      ends: raw.ends,
      closedState: pipe.isClosed(),
      sent: raw.writes.map((value: any) => value.toString('hex')),
      error
    }
  })
})
test('single response delivers only at close, normalizes callback failure and custom socket close', async () => {
  await compare(async (Pipe, _Decoder, encode) => {
    const raw = socket(),
      messages: any[] = [],
      closed: any[] = [],
      pipe = new Pipe(raw, {
        singleResponse: true,
        decodeMessage: (value: any) => value,
        closeSocket: () => closed.push('socket')
      })
    pipe.setMessageCallback((value: any) => {
      messages.push(value)
      throw 'callback failure'
    })
    pipe.addCloseListener((error: any) => closed.push(error?.message))
    raw.emit('data', encode('{"a":1}'))
    const before = [...messages]
    raw.emit('close')
    await Promise.resolve()
    return { before, messages, closed, ends: raw.ends, closedState: pipe.isClosed() }
  })
})
test('invalid JSON/decode failure closes and discarded sockets no longer dispatch data', async () => {
  await compare(async (Pipe, _Decoder, encode) => {
    const raw = socket(),
      pipe = new Pipe(raw, { decodeMessage: (value: any) => value }),
      closed: any[] = [],
      messages: any[] = []
    pipe.addCloseListener((error: any) => closed.push(error?.message))
    pipe.setMessageCallback((message: any) => messages.push(message))
    raw.emit('data', encode('invalid'))
    await Promise.resolve()
    await Promise.resolve()
    raw.emit('data', encode('{}'))
    return { closed, ends: raw.ends, messages }
  })
})
