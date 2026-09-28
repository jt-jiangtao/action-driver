// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mirrorMap } from '../src/core/mirror-map'
import { UnreachableCaseError } from '../src/core/unreachable-case-error'
const base = resolve('apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_core/src')
async function original(file: string) {
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(await readFile(resolve(base, file), 'utf8')).toString('base64')
  )
}
test('mirrorMap matches original reverse values, collisions and enumeration', async () => {
  const { mirror_map } = await original('mirror_map.js')
  for (const input of [
    { a: 'apple' },
    { a: 1, b: 2 },
    { a: 'x', b: 'x' },
    { a: 'b', b: 'a' },
    Object.assign({ a: 'apple' }, { [Symbol('ignored')]: 'x' })
  ])
    expect(mirrorMap(input)).toEqual(mirror_map(input))
  expect(mirrorMap({ a: 'apple' })).toEqual({ a: 'apple', apple: 'a' })
})
test('unreachable error retains name and message semantics', async () => {
  const { UnreachableCaseError: Reference } = await original('UnreachableCaseError.js')
  for (const value of ['unexpected', 42, null]) {
    const a = new UnreachableCaseError(value as never),
      b = new Reference(value)
    expect(a.name).toBe(b.name)
    expect(a.message).toBe(b.message)
    expect(a).toBeInstanceOf(Error)
  }
})
