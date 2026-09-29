// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile, symlink, chmod, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureBaseline, verifyBaseline } from '../../src/baseline'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })))
})
async function fixture() {
  const r = await mkdtemp(join(tmpdir(), 'cua-baseline-'))
  roots.push(r)
  await writeFile(join(r, 'a.js'), 'original')
  return r
}
test('capture is stable and verify does not alter the baseline', async () => {
  const r = await fixture()
  const b = await captureBaseline(r)
  expect(await captureBaseline(r)).toEqual(b)
  expect(await verifyBaseline(r, b)).toEqual([])
})
test('rejects added, removed and changed bytes', async () => {
  const r = await fixture()
  await writeFile(join(r, 'remove'), 'x')
  const b = await captureBaseline(r)
  await writeFile(join(r, 'a.js'), 'changed')
  await writeFile(join(r, 'new'), 'x')
  await unlink(join(r, 'remove'))
  expect(await verifyBaseline(r, b)).toEqual([
    { path: 'a.js', reason: 'changed' },
    { path: 'new', reason: 'added' },
    { path: 'remove', reason: 'removed' }
  ])
})
test('records symlinks without reading targets and notices permissions', async () => {
  const r = await fixture()
  await symlink('/missing-target', join(r, 'link'))
  const b = await captureBaseline(r)
  expect(b.files.find((f) => f.path === 'link')).toEqual({
    path: 'link',
    kind: 'symlink',
    target: '/missing-target'
  })
  await chmod(join(r, 'a.js'), 0o700)
  await unlink(join(r, 'link'))
  await symlink('/other', join(r, 'link'))
  expect((await verifyBaseline(r, b)).map((f) => f.path)).toEqual(['a.js', 'link'])
})
test('package metadata cannot drift while file hashes stay the same', async () => {
  const r = await fixture()
  const b = await captureBaseline(r)
  expect(
    await verifyBaseline(r, { ...b, packages: { fake: { version: '9', entry: 'fake.js' } } })
  ).toEqual([{ path: '@metadata/packages', reason: 'changed' }])
})
