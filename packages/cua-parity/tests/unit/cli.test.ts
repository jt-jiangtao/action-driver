// @vitest-environment node
import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { captureBaseline } from '../../src/baseline'
const exec = promisify(execFile)
test('inventory CLI refuses overwriting vendor files and baseline inputs', async () => {
  const r = await mkdtemp(join(tmpdir(), 'cua-cli-'))
  try {
    const root = join(r, 'vendor')
    await mkdir(root)
    const sentinel = join(root, 'a.js')
    await writeFile(sentinel, 'export {}')
    const baseline = join(r, 'baseline.json')
    await writeFile(baseline, JSON.stringify(await captureBaseline(root)))
    const cli = resolve('packages/cua-parity/dist/cli.js')
    await expect(
      exec(process.execPath, [cli, 'inventory', root, baseline, sentinel])
    ).rejects.toThrow()
    expect(await readFile(sentinel, 'utf8')).toBe('export {}')
    await expect(
      exec(process.execPath, [cli, 'inventory', root, baseline, baseline])
    ).rejects.toThrow()
  } finally {
    await rm(r, { recursive: true, force: true })
  }
})
