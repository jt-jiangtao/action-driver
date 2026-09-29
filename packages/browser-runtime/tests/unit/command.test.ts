// @vitest-environment node
import { expect, test } from 'vitest'
import { AtlasCommand } from '../../src/command'
import { originalClient } from '../original-client'

test('command delegates parse without eagerly validating or replacing its payload', async () => {
  const { baselineApi } = await originalClient()
  function exercise(Type: any) {
    const payload = { value: 1 },
      calls: unknown[] = [],
      parsed = { value: 2 }
    const schema = {
      parse(value: unknown) {
        calls.push({ value, receiver: this === schema })
        return parsed
      }
    }
    const command = new Type('test', schema, payload)
    expect(calls).toEqual([])
    expect(command.parse()).toBe(parsed)
    expect(command.payload).toBe(payload)
    payload.value = 3
    return { json: command.toJSON(), calls, keys: Object.keys(command) }
  }
  expect(exercise(AtlasCommand)).toEqual(exercise(baselineApi.AtlasCommand))
})
for (const payload of [undefined, null, { type: 'override', value: 1 }, ['a', 'b'], 'text'])
  test(`command JSON uses original enumerable spread for ${JSON.stringify(payload)}`, async () => {
    const { baselineApi } = await originalClient()
    const schema = { parse: (value: unknown) => value }
    expect(new AtlasCommand('test', schema, payload).toJSON()).toEqual(
      new baselineApi.AtlasCommand('test', schema, payload).toJSON()
    )
  })
test('command observes replacement public fields and propagates parser error identity', async () => {
  const { baselineApi } = await originalClient()
  function exercise(Type: any) {
    const error = new Error('parse'),
      calls: unknown[] = []
    const command = new Type('before', { parse: () => null }, {})
    command.type = 'after'
    command.payload = { value: 3 }
    command.schema = {
      parse(value: unknown) {
        calls.push(value)
        throw error
      }
    }
    expect(() => command.parse()).toThrow(error)
    try {
      command.parse()
    } catch (caught) {
      expect(caught).toBe(error)
    }
    return { json: command.toJSON(), calls }
  }
  expect(exercise(AtlasCommand)).toEqual(exercise(baselineApi.AtlasCommand))
})
test('JSON property getters run in spread order and keep symbol properties', async () => {
  const { baselineApi } = await originalClient()
  const symbol = Symbol('field')
  function exercise(Type: any) {
    const events: unknown[] = []
    const payload = Object.create({ inherited: 1 })
    Object.defineProperty(payload, 'field', {
      enumerable: true,
      get() {
        events.push('field')
        return 2
      }
    })
    payload[symbol] = 3
    const command = new Type('test', { parse: (value: unknown) => value }, payload)
    const first = command.toJSON(),
      second = command.toJSON()
    expect(first).not.toBe(second)
    return { first, events, keys: Reflect.ownKeys(first) }
  }
  expect(exercise(AtlasCommand)).toEqual(exercise(baselineApi.AtlasCommand))
})
