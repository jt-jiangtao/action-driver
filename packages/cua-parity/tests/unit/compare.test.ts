// @vitest-environment node
import { expect, test } from 'vitest'
import { compareOutcomes } from '../../src/compare'
import type { Outcome } from '../../src/types'
const good: Outcome = {
  status: 'returned',
  value: { id: 1 },
  error: null,
  trace: [],
  stdout: '',
  stderr: ''
}
test('compares results and errors without implicit filtering', () => {
  expect(compareOutcomes(good, { ...good, value: { id: 2 } }, [])).toHaveLength(1)
  expect(
    compareOutcomes(
      good,
      { ...good, status: 'threw', error: { name: 'Error', message: 'bad', code: 'X' } },
      []
    ).length
  ).toBeGreaterThan(0)
})
test('normalization requires explicit existing path and reason', () => {
  expect(
    compareOutcomes(good, { ...good, value: { id: 2 } }, [
      { path: '/value/id', reason: 'Fixture-generated ID' }
    ])
  ).toEqual([])
  expect(() => compareOutcomes(good, good, [{ path: '/missing', reason: 'x' }])).toThrow()
  expect(() => compareOutcomes(good, good, [{ path: '/value/id', reason: '' }])).toThrow()
  expect(() => compareOutcomes(good, good, [{ path: '/*', reason: 'x' }])).toThrow()
})
test('event ordering is observable', () => {
  const x = { kind: 'event' as const, name: 'one', payload: null },
    y = { ...x, name: 'two' }
  expect(
    compareOutcomes({ ...good, trace: [x, y] }, { ...good, trace: [y, x] }, []).length
  ).toBeGreaterThan(0)
})
test('missing fields cannot silently equal null', () => {
  expect(compareOutcomes({ ...good, value: {} }, { ...good, value: { x: null } }, [])).toHaveLength(
    1
  )
})
test('own properties named like prototype properties cannot disappear', () => {
  const other = JSON.parse('{"__proto__":{}}')
  expect(compareOutcomes({ ...good, value: {} }, { ...good, value: other }, [])).toHaveLength(1)
  const diff = compareOutcomes({ ...good, value: {} }, { ...good, value: { toString: null } }, [])
  expect(() => JSON.stringify(diff)).not.toThrow()
  expect(diff[0]?.expected).toEqual({ missing: true })
})
