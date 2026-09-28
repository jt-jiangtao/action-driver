// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureBaseline } from '../src/baseline'
test('candidate packages stay separate from production', async () => {
  for (const name of ['cua', 'sky', 'cua-repl', 'browser-runtime', 'cua-parity']) {
    const p = JSON.parse(await readFile(resolve('packages', name, 'package.json'), 'utf8'))
    expect(p.name).toBe('@actiondriver/' + name)
    expect(p.private).toBe(true)
    expect(p.scripts.build).toBeTruthy()
    expect(p.scripts.typecheck).toBeTruthy()
    expect(JSON.stringify(p.dependencies ?? {})).not.toMatch(/@oai|vendor/)
  }
  const runtime = await readFile('apps/agent-runtime/package.json', 'utf8')
  expect(runtime).not.toMatch(/@actiondriver\/(cua|sky|cua-repl|browser-runtime)(?:"|\/)/)
  const loader = await readFile('apps/agent-runtime/src/runtime-process.ts', 'utf8')
  expect(loader).toContain("vendor/codex-cua")
  expect(loader).not.toMatch(/packages\/back\/codex-cua|@actiondriver\/cua-repl/)
})

test('every copied original remains byte-identical in packages/back', async () => {
  const vendor = await captureBaseline(resolve('apps/agent-runtime/vendor/codex-cua'))
  const backup = await captureBaseline(resolve('packages/back/codex-cua'))
  expect(backup).toEqual(vendor)
})

test('candidate source files and identifiers do not retain the original oai_ prefix', async () => {
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      expect(entry.name).not.toContain('oai_')
      if (entry.isDirectory()) await check(file)
      else if (/\.(?:ts|js|mjs)$/.test(entry.name))
        expect(await readFile(file, 'utf8')).not.toContain('oai_')
    }
  }
  for (const name of ['cua', 'sky', 'cua-repl', 'browser-runtime'])
    await check(resolve('packages', name, 'src'))
})
