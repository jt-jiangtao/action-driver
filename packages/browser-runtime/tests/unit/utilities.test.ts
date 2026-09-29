// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { isPlainObject, isRegExp, hasErrorMessage, generateRequestId } from '../../src/utilities'
import { originalClient } from '../original-client'
test('plain-object and RegExp predicates match original across realms and prototypes', async () => {
  const { baselineApi } = await originalClient()
  class Custom {}
  const values = [
    null,
    undefined,
    1,
    () => {},
    [],
    {},
    Object.create(null),
    new Custom(),
    new Date(),
    /a/gi,
    runInNewContext('({value:1})'),
    runInNewContext('/a/'),
    Object.create(RegExp.prototype),
    { [Symbol.toStringTag]: 'RegExp' }
  ]
  for (const value of values) {
    expect(isPlainObject(value)).toBe(baselineApi.isPlainObject(value))
    expect(isRegExp(value)).toBe(baselineApi.isRegExp(value))
  }
})
test('error message test handles hostile property access and exact matching', async () => {
  const { baselineApi } = await originalClient()
  for (const value of [
    new Error('x'),
    { message: 'x' },
    Object.create({ message: 'x' }),
    {
      get message() {
        throw new Error('hostile')
      }
    },
    new Proxy(
      {},
      {
        has() {
          throw new Error('hostile')
        }
      }
    ),
    'x',
    null
  ])
    for (const message of ['x', 'other'])
      expect(hasErrorMessage(value, message)).toBe(baselineApi.hasErrorMessage(value, message))
})
test('request ID uses original hex timestamp/random format', async () => {
  const { baselineApi } = await originalClient()
  const now = vi.spyOn(Date, 'now').mockReturnValue(123456)
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  try {
    expect(generateRequestId()).toBe(baselineApi.generateRequestId())
  } finally {
    now.mockRestore()
    random.mockRestore()
  }
})
