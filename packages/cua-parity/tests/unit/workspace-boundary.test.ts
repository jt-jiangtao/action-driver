// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureBaseline } from '../../src/baseline'
test('production loads owned packages and does not reference the offline backup', async () => {
  for (const name of ['cua', 'sky', 'cua-repl', 'browser-runtime', 'cua-parity']) {
    const p = JSON.parse(await readFile(resolve('packages', name, 'package.json'), 'utf8'))
    expect(p.name).toBe('@action-driver/' + name)
    expect(p.private).toBe(true)
    expect(p.scripts.build).toBeTruthy()
    expect(p.scripts.typecheck).toBeTruthy()
    expect(JSON.stringify(p.dependencies ?? {})).not.toMatch(/@oai|vendor/)
  }
  const runtime = await readFile('apps/agent-runtime/package.json', 'utf8')
  expect(runtime).toContain('@action-driver/cua')
  expect(runtime).toContain('@action-driver/sky')
  const loader = await readFile('apps/agent-runtime/src/runtime-process.ts', 'utf8')
  expect(loader).not.toMatch(/vendor\/codex-cua|thirdparty\/backup\/codex-cua/)
})

test('offline original backup is present and remains isolated', async () => {
  const backup = await captureBaseline(resolve('thirdparty/backup/codex-cua'))
  expect(backup.files.length).toBeGreaterThan(100)
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
