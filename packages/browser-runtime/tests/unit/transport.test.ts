// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { FunctionAgentTransport } from '../../src/transport'
import { originalClient } from '../original-client'
const command = { toJSON: () => ({ command: 'test', params: { id: 1 }, client_timeout_ms: 99 }) }
test('function transport preserves envelope, timeout and ordered side effects like original', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Transport: any) {
    const calls: unknown[] = []
    const transport = new Transport({
      executeAgentCommand: async (input: unknown) => {
        calls.push({ input })
        return { side_effects: ['first', 'second'], result: 1 }
      },
      displaySideEffect: async (effect: unknown) => {
        calls.push({ effect })
      }
    })
    const results = []
    for (const timeoutMs of [undefined, 0, -1, 10, Infinity])
      results.push(await transport.send({ command, timeoutMs }))
    await transport.display('manual')
    return { calls, results }
  }
  expect(await exercise(FunctionAgentTransport)).toEqual(
    await exercise(baselineApi.FunctionAgentTransport)
  )
})
test('invalid side_effect envelopes are returned unchanged without display', async () => {
  const sideEffects = vi.fn()
  for (const value of [
    { side_effects: [1], result: 2 },
    { side_effects: null },
    'text',
    0,
    false
  ]) {
    const transport = new FunctionAgentTransport({
      executeAgentCommand: async () => value,
      displaySideEffect: sideEffects
    })
    expect(await transport.send({ command })).toBe(value)
  }
  expect(sideEffects).not.toHaveBeenCalled()
})
test('empty response, missing executor and failing side effect reject', async () => {
  expect(() => new FunctionAgentTransport({} as never)).toThrow('requires an executeAgentCommand')
  for (const value of [null, undefined])
    await expect(
      new FunctionAgentTransport({ executeAgentCommand: async () => value }).send({ command })
    ).rejects.toThrow('empty response')
  const execute = vi.fn(async () => ({ side_effects: ['first', 'second'] }))
  const display = vi.fn(async () => {
    throw new Error('display failed')
  })
  await expect(
    new FunctionAgentTransport({ executeAgentCommand: execute, displaySideEffect: display }).send({
      command
    })
  ).rejects.toThrow('display failed')
  expect(display).toHaveBeenCalledTimes(1)
})
test('non-record side-effect containers follow original validation and remain unchanged', async () => {
  const { baselineApi } = await originalClient()
  for (const base of [[], new Date(), new Map(), new Set(), Promise.resolve(1)]) {
    const value = Object.assign(base, { side_effects: ['effect'] })
    const ownEffects: unknown[] = [],
      refEffects: unknown[] = []
    const own = new FunctionAgentTransport({
        executeAgentCommand: async () => value,
        displaySideEffect: (e) => {
          ownEffects.push(e)
        }
      }),
      ref = new baselineApi.FunctionAgentTransport({
        executeAgentCommand: async () => value,
        displaySideEffect: (e: unknown) => {
          refEffects.push(e)
        }
      })
    const ownResult = await own.send({ command }),
      refResult = await ref.send({ command })
    expect(ownResult).toEqual(refResult)
    expect(ownEffects).toEqual(refEffects)
  }
})
test('sparse effect arrays are invalid and must not display undefined', async () => {
  const effects = new Array(1),
    value = { side_effects: effects, result: 1 }
  const display = vi.fn()
  const transport = new FunctionAgentTransport({
    executeAgentCommand: async () => value,
    displaySideEffect: display
  })
  expect(await transport.send({ command })).toBe(value)
  expect(display).not.toHaveBeenCalled()
})
test('validated response keeps enumerable string fields and omits undefined, symbols and prototype keys', async () => {
  const { baselineApi } = await originalClient()
  const response = Object.assign(Object.create({ inherited: 1 }), {
    side_effects: [],
    value: undefined,
    own: 2,
    [Symbol('hidden')]: 3
  })
  Object.defineProperty(response, '__proto__', { value: { unsafe: true }, enumerable: true })
  async function exercise(Transport: any) {
    const result = await new Transport({ executeAgentCommand: async () => response }).send({
      command
    })
    return { result, keys: Reflect.ownKeys(result), prototype: Object.getPrototypeOf(result) }
  }
  expect(await exercise(FunctionAgentTransport)).toEqual(
    await exercise(baselineApi.FunctionAgentTransport)
  )
})
test('validated response and effect sequence are snapshotted before display callbacks', async () => {
  const { baselineApi } = await originalClient()
  async function exercise(Transport: any) {
    const response = { side_effects: ['first', 'second'], result: 1 }
    const displayed: unknown[] = []
    const transport = new Transport({
      executeAgentCommand: async () => response,
      displaySideEffect: async (effect: unknown) => {
        displayed.push(effect)
        if (effect === 'first') {
          response.result = 2
          response.side_effects.push('third')
        }
      }
    })
    return { result: await transport.send({ command }), displayed }
  }
  expect(await exercise(FunctionAgentTransport)).toEqual(
    await exercise(baselineApi.FunctionAgentTransport)
  )
})
