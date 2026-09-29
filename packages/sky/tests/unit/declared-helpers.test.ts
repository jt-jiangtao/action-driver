// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { env, unimplemented } from '../../src/core/env'
test('env normalizes values and caches first successful/default read', () => {
  vi.stubEnv('ACTIONDRIVER_TEST_OPTION', '  BUILD ')
  const reader = env({
    name: 'ACTIONDRIVER_TEST_OPTION',
    options: ['build', 'cache'] as const,
    default: 'cache'
  })
  expect(reader.get()).toBe('build')
  vi.stubEnv('ACTIONDRIVER_TEST_OPTION', 'cache')
  expect(reader.get()).toBe('build')
  vi.unstubAllEnvs()
})
for (const value of [undefined, '', '  '])
  test(`env missing ${String(value)} defaults or rejects according to policy`, () => {
    vi.stubEnv('ACTIONDRIVER_TEST_OPTION', value)
    try {
      expect(
        env({
          name: 'ACTIONDRIVER_TEST_OPTION',
          options: ['on', 'off'] as const,
          default: 'off'
        }).get()
      ).toBe('off')
      expect(() =>
        env({
          name: 'ACTIONDRIVER_TEST_OPTION',
          options: ['on', 'off'] as const,
          default: 'off',
          missing: 'throw'
        }).get()
      ).toThrow('is required')
    } finally {
      vi.unstubAllEnvs()
    }
  })
test('env invalid throws by default, retries failed reads and supports fallback caching', () => {
  vi.stubEnv('ACTIONDRIVER_TEST_OPTION', 'invalid')
  try {
    const args = {
      name: 'ACTIONDRIVER_TEST_OPTION',
      options: ['on', 'off'] as const,
      default: 'off' as const
    }
    const strict = env(args)
    expect(() => strict.get()).toThrow('Invalid')
    const fallback = env({ ...args, invalid: 'default' })
    expect(fallback.get()).toBe('off')
    vi.stubEnv('ACTIONDRIVER_TEST_OPTION', 'on')
    expect(strict.get()).toBe('on')
    expect(fallback.get()).toBe('off')
  } finally {
    vi.unstubAllEnvs()
  }
})
test('env custom normalization receives raw input once and failures are retryable', () => {
  vi.stubEnv('ACTIONDRIVER_TEST_OPTION', ' ALIAS ')
  try {
    let calls = 0
    const error = new Error('normalize')
    const reader = env({
      name: 'ACTIONDRIVER_TEST_OPTION',
      options: ['on', 'off'] as const,
      default: 'off',
      normalize: (raw) => {
        expect(raw).toBe(' ALIAS ')
        if (++calls === 1) throw error
        return 'on'
      }
    })
    expect(() => reader.get()).toThrow(error)
    expect(reader.get()).toBe('on')
    expect(reader.get()).toBe('on')
    expect(calls).toBe(2)
  } finally {
    vi.unstubAllEnvs()
  }
})
test('env help documents name, values and configured policies without reading environment', () => {
  const normalize = vi.fn()
  const reader = env({
    name: 'ACTIONDRIVER_TEST_OPTION',
    options: ['on', 'off'] as const,
    default: 'off',
    missing: 'throw',
    invalid: 'default',
    normalize
  })
  expect(reader.help()).toBe(
    'ACTIONDRIVER_TEST_OPTION: on | off (default: off; missing: throw; invalid: default)'
  )
  expect(normalize).not.toHaveBeenCalled()
})
test('env rejects a default outside the declared allowed values', () => {
  expect(() => env({ name: 'X', options: ['a'], default: 'b' } as never)).toThrow(
    'default must be one of'
  )
})
test('unimplemented returns a fresh project-defined Error without throwing', () => {
  const first = unimplemented('click')
  expect(first).toBeInstanceOf(Error)
  expect(first.message).toBe('Tool not implemented: click')
  expect(unimplemented('click')).not.toBe(first)
})
