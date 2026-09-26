import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageComputerUse } from './copy-js-entry.mjs'

test('stages the executor and complete vendor tree unchanged, removing stale vendor files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actiondriver-cua-stage-'))
  try {
    for (const path of ['resources/js-repl', 'vendor/codex-cua/@oai/cua/docs', 'vendor/codex-cua/skills/computer-use/assets', 'dist/vendor/codex-cua']) {
      await mkdir(join(root, path), { recursive: true })
    }
    await writeFile(join(root, 'resources/js-repl/repl-server.mjs'), 'export const executor = true')
    await writeFile(join(root, 'vendor/codex-cua/@oai/cua/docs/api.md'), 'original documentation')
    await writeFile(join(root, 'vendor/codex-cua/skills/computer-use/assets/icon.bin'), Buffer.from([0, 255, 17]))
    await writeFile(join(root, 'dist/vendor/codex-cua/stale.js'), 'removed source')
    await stageComputerUse(root)
    assert.equal(await readFile(join(root, 'dist/js-repl/repl-server.mjs'), 'utf8'), 'export const executor = true')
    assert.equal(await readFile(join(root, 'dist/vendor/codex-cua/@oai/cua/docs/api.md'), 'utf8'), 'original documentation')
    assert.deepEqual(await readFile(join(root, 'dist/vendor/codex-cua/skills/computer-use/assets/icon.bin')), Buffer.from([0, 255, 17]))
    await assert.rejects(access(join(root, 'dist/vendor/codex-cua/stale.js')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
