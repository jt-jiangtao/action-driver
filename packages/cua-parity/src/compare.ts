import { assertJson } from './json.js'
import type { Difference, NormalizationRule, Outcome } from './types.js'
export function compareOutcomes(
  reference: Outcome,
  candidate: Outcome,
  rules: NormalizationRule[]
): Difference[] {
  assertJson(reference)
  assertJson(candidate)
  const a = structuredClone(reference),
    b = structuredClone(candidate)
  for (const rule of rules) {
    if (!rule.reason.trim() || !rule.path.startsWith('/') || rule.path.includes('*'))
      throw new Error('Invalid normalization rule')
    const keys = rule.path
      .slice(1)
      .split('/')
      .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'))
    for (const value of [a, b]) {
      let current: unknown = value
      for (const [index, key] of keys.entries()) {
        if (!current || typeof current !== 'object' || !Object.hasOwn(current, key))
          throw new Error('Normalization path missing')
        const object = current as Record<string, unknown>
        if (index === keys.length - 1) object[key] = null
        else current = object[key]
      }
    }
  }
  const differences: Difference[] = []
  function walk(x: unknown, y: unknown, path: string) {
    if (Object.is(x, y)) return
    if (
      x !== null &&
      y !== null &&
      typeof x === 'object' &&
      typeof y === 'object' &&
      Array.isArray(x) === Array.isArray(y)
    ) {
      const left = x as Record<string, unknown>,
        right = y as Record<string, unknown>
      if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length)
        differences.push({ path: path + '/length', expected: x.length, actual: y.length })
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        const nextPath = path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1')
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
          differences.push({
            path: nextPath,
            expected: Object.hasOwn(left, key) ? left[key] : { missing: true },
            actual: Object.hasOwn(right, key) ? right[key] : { missing: true }
          })
        } else walk(left[key], right[key], nextPath)
      }
    } else differences.push({ path, expected: x ?? null, actual: y ?? null })
  }
  walk(a, b, '')
  return differences
}
