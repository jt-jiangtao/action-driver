// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { captureDesktopBaseline, verifyDesktopBaseline } from '../../src/desktop-baseline'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-baseline-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@oai/browser-desktop', version: '0.1.1' }))
  await mkdir(join(root, 'scripts'))
  await writeFile(join(root, 'scripts/browser-client.mjs'), 'export const client = 1')
  return root
}

test('captures desktop version, files and stable source/backup parity', async () => {
  const source = await fixture()
  const backup = await fixture()
  const baseline = await captureDesktopBaseline(source)
  expect(baseline.version).toBe('0.1.1')
  expect(baseline.files.find((file) => file.path === 'scripts/browser-client.mjs')).toMatchObject({
    kind: 'file', bytes: 23, mode: 0o644
  })
  expect(await verifyDesktopBaseline(backup, baseline)).toEqual([])
  expect(await captureDesktopBaseline(source)).toEqual(baseline)
})

test('reports changed bytes, removed files and permissions by path', async () => {
  const root = await fixture()
  await writeFile(join(root, 'remove.txt'), 'removed')
  const baseline = await captureDesktopBaseline(root)
  await writeFile(join(root, 'scripts/browser-client.mjs'), 'changed')
  await chmod(join(root, 'package.json'), 0o600)
  await unlink(join(root, 'remove.txt'))
  expect(await verifyDesktopBaseline(root, baseline)).toEqual([
    { path: 'package.json', reason: 'changed' },
    { path: 'remove.txt', reason: 'removed' },
    { path: 'scripts/browser-client.mjs', reason: 'changed' }
  ])
})

test('rejects metadata drift and never imports source from backup into candidate', async () => {
  const root = await fixture()
  const baseline = await captureDesktopBaseline(root)
  expect(await verifyDesktopBaseline(root, { ...baseline, version: '9.9.9' })).toEqual([
    { path: '@metadata/version', reason: 'changed' }
  ])
  const candidate = await readFile(resolve('packages/browser-runtime/src/runtime-initialization.ts'), 'utf8')
  expect(candidate).not.toMatch(/packages\/back|vendor\/codex-cua/)
})
