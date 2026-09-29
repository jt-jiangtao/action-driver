// @vitest-environment node
import { expect, test } from 'vitest'
import { resolve } from 'node:path'
import { originalModule } from '../../../cua/tests/original-module'
import { encodeMessageFrame, decodeMessageFrames } from '../../src/mac/rpc-codec'
import { ServerErrorCode, ComputerUseError, ComputerUseTransportError } from '../../src/mac/errors'
const root = 'thirdparty/backup/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/mac'
test('framing matches original for UTF8, empty and coalesced/partial messages', async () => {
  const ref = await originalModule(resolve(root, 'native-pipe.js'))
  for (const value of ['', '中文😀', JSON.stringify({ id: 1 })])
    expect(encodeMessageFrame(value)).toEqual(ref.encodeMessageFrame!(value))
  const frame = Buffer.concat([
    encodeMessageFrame('one'),
    encodeMessageFrame('二'),
    encodeMessageFrame('partial')
  ])
  for (let end = 0; end <= frame.length; end++) {
    const bytes = frame.subarray(0, end)
    expect(decodeMessageFrames(bytes)).toEqual(ref.decodeMessageFrames!(bytes))
  }
})
test('frame size limit is bytes and rejects oversized headers before body', () => {
  expect(encodeMessageFrame('x'.repeat(8388608))).toHaveLength(8388612)
  expect(() => encodeMessageFrame('é'.repeat(4194305))).toThrow('frame is too large: 8388610')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(8388609)
  expect(() => decodeMessageFrames(header)).toThrow('frame is too large: 8388609')
})
test('every server code and error observation matches original', async () => {
  const ref = await originalModule(resolve(root, 'errors.js'))
  expect(ServerErrorCode).toEqual(ref.ServerErrorCode)
  for (const code of [...Object.values(ServerErrorCode), -32603]) {
    const args = { code, message: 'failed', request: { app: 'app' }, requestType: 'action' }
    const own = new ComputerUseError(args)
    const original = new (ref.SkyComputerUseError as any)(args)
    expect({
      name: own.name,
      message: own.message,
      code: own.code,
      errorName: own.errorName,
      request: own.request,
      requestType: own.requestType
    }).toEqual({
      name: original.name,
      message: original.message,
      code: original.code,
      errorName: original.errorName,
      request: original.request,
      requestType: original.requestType
    })
  }
  const cause = new Error('cause')
  expect(new ComputerUseTransportError('failed', { cause }).cause).toBe(cause)
})
