// @vitest-environment node
import { expect, test } from 'vitest'
import { displayValue } from '../src/display'
import { originalClient } from './original-client'
test('display renders primitives, wrappers, JSON, byte images and errors like original', async () => {
  const { baselineDisplay } = await originalClient()
  const circular: any = {}
  circular.self = circular
  async function run(fn: any, value: unknown, max: number) {
    const result: unknown[] = []
    await fn(
      {
        displayImage: async (bytes: Uint8Array) => {
          result.push({ image: [...bytes] })
        },
        displayValue: async (rendered: unknown) => {
          result.push(rendered)
        }
      },
      value,
      max
    )
    return result
  }
  for (const value of [
    undefined,
    null,
    () => {},
    true,
    3,
    Infinity,
    NaN,
    'text',
    new String('text'),
    new Number(3),
    new Boolean(false),
    { a: 1 },
    [1, 2],
    new Uint8Array([1, 2]),
    Symbol('symbol'),
    circular
  ])
    for (const max of [0, 2, 1.5, -1, 100000])
      expect(await run(displayValue, value, max)).toEqual(await run(baselineDisplay, value, max))
})
test('image display failure becomes an error value while value display failure propagates', async () => {
  const outputs: unknown[] = []
  await displayValue(
    {
      displayImage: async () => {
        throw new Error('image failed')
      },
      displayValue: (value) => {
        outputs.push(value)
      }
    },
    new Uint8Array([1])
  )
  expect(outputs).toEqual([{ type: 'error', value: 'Error: image failed' }])
  await expect(
    displayValue(
      {
        displayImage: () => {},
        displayValue: async () => {
          throw new Error('output failed')
        }
      },
      'text'
    )
  ).rejects.toThrow('output failed')
})
