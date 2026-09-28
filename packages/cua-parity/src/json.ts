export function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || value === null || ancestors.has(value))
    throw new Error('Value is not plain JSON')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error('Value is not plain JSON')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new Error('Sparse JSON array')
      assertJson(value[i], ancestors)
    }
  } else {
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Symbol keys are not JSON')
    for (const v of Object.values(value)) assertJson(v, ancestors)
  }
  ancestors.delete(value)
}
