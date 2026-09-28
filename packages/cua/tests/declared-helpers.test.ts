// @vitest-environment node
import { test, expect, vi } from 'vitest'
import {
  createDelayedAction,
  createLazyEvaluator,
  sleep,
  enumerate,
  invariant
} from '../src/core/declared-helpers'
test('debounce runs latest arguments and receiver once after delay, supports new bursts', () => {
  vi.useFakeTimers()
  try {
    const seen: unknown[] = []
    const delayed = createDelayedAction(function (this: unknown, value: number) {
      seen.push([this, value])
    }, 20)
    const first = { id: 1 },
      last = { id: 2 }
    delayed.call(first, 1)
    vi.advanceTimersByTime(10)
    delayed.call(last, 2)
    vi.advanceTimersByTime(19)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual([[last, 2]])
    delayed.call(first, 3)
    vi.advanceTimersByTime(20)
    expect(seen).toEqual([
      [last, 2],
      [first, 3]
    ])
  } finally {
    vi.useRealTimers()
  }
})
test('default debounce remains asynchronous and callback throws surface from scheduled action', () => {
  vi.useFakeTimers()
  try {
    const action = vi.fn()
    createDelayedAction(action)()
    expect(action).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(action).toHaveBeenCalledTimes(1)
    const error = new Error('action')
    createDelayedAction(() => {
      throw error
    })() // Scheduled errors do not silently disappear.
    expect(() => vi.runAllTimers()).toThrow(error)
  } finally {
    vi.useRealTimers()
  }
})
test('lazy caches undefined/null/Promise identity and first call receiver', async () => {
  for (const value of [undefined, null, Promise.resolve(1)]) {
    const evaluate = vi.fn(function (this: any, arg: number) {
      expect(this.id).toBe(1)
      expect(arg).toBe(1)
      return value
    })
    const lazy = createLazyEvaluator(evaluate)
    expect(lazy.call({ id: 1 }, 1)).toBe(value)
    expect(lazy.call({ id: 2 }, 2)).toBe(value)
    expect(evaluate).toHaveBeenCalledTimes(1)
  }
})
test('lazy retries synchronous exceptions and caches rejected Promise as a returned value', async () => {
  const error = new Error('evaluate')
  let calls = 0
  const lazy = createLazyEvaluator(() => {
    if (++calls === 1) throw error
    return 2
  })
  expect(() => lazy()).toThrow(error)
  expect(lazy()).toBe(2)
  expect(lazy()).toBe(2)
  expect(calls).toBe(2)
  const rejected = Promise.reject(error),
    evaluate = vi.fn(() => rejected),
    asyncLazy = createLazyEvaluator(evaluate)
  await expect(asyncLazy()).rejects.toBe(error)
  expect(asyncLazy()).toBe(rejected)
  expect(evaluate).toHaveBeenCalledTimes(1)
})
test('sleep resolves only after scheduled duration with undefined', async () => {
  vi.useFakeTimers()
  try {
    let finished = false
    const pending = sleep(20).then((value) => {
      finished = true
      expect(value).toBeUndefined()
    })
    await vi.advanceTimersByTimeAsync(19)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(finished).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
test('enumeration is lazy, indexes iterable order, and closes source on early exit', async () => {
  let closed = false
  function* source() {
    try {
      yield 'a'
      yield 'b'
    } finally {
      closed = true
    }
  }
  expect([...enumerate(new Set(['a', 'b']))]).toEqual([
    [0, 'a'],
    [1, 'b']
  ])
  for (const pair of enumerate(source())) {
    expect(pair).toEqual([0, 'a'])
    break
  }
  expect(closed).toBe(true)
  expect([...enumerate([])]).toEqual([])
  let asyncClosed = false
  async function* input() {
    try {
      yield Promise.resolve('a')
      yield 'b'
    } finally {
      asyncClosed = true
    }
  }
  const seen = []
  for await (const pair of enumerate.async(input())) {
    seen.push(pair)
    break
  }
  expect(seen).toEqual([[0, 'a']])
  expect(asyncClosed).toBe(true)
})
test('enumeration propagates iterator errors and invariant checks truthiness', async () => {
  const error = new Error('iterator')
  function* bad() {
    yield 1
    throw error
  }
  expect(() => [...enumerate(bad())]).toThrow(error)
  // eslint-disable-next-line require-yield -- the iterator fails before producing a value
  async function* asyncBad() {
    throw error
  }
  await expect(enumerate.async(asyncBad()).next()).rejects.toBe(error)
  for (const value of [false, 0, '', null, undefined, NaN])
    expect(() => invariant(value, 'condition')).toThrow('condition')
  for (const value of [true, 1, 'x', [], {}])
    expect(() => invariant(value, 'condition')).not.toThrow()
})
