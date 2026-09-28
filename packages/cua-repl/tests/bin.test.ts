// @vitest-environment node
import { expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const execute = promisify(execFile)
const root = resolve('packages/cua-repl')

test('packed macOS REPL exposes an executable that delegates to launch', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  expect(manifest.bin?.['cua-repl']).toBe('bin/cua-repl.mjs')
  expect(manifest.dependencies?.['@actiondriver/cua']).toBe('workspace:*')
  await expect(execute(process.execPath, [resolve(root, manifest.bin['cua-repl'])], {
    env: { ...process.env, CUA_REPL_NODE_REPL_PATH: '' }
  })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('CUA_REPL_NODE_REPL_PATH must name an absolute executable') })
})

test('REPL plugin template is preserved byte-for-byte and included in the package files', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  expect(manifest.files).toContain('plugin')
  expect(await readFile(resolve(root, 'plugin/.mcp.template.json'))).toEqual(
    await readFile(resolve('apps/agent-runtime/vendor/codex-cua/@oai/cua-repl/plugin/.mcp.template.json'))
  )
  expect(await readFile(resolve(root, 'plugin/.codex-plugin/plugin.json'))).toEqual(
    await readFile(resolve('apps/agent-runtime/vendor/codex-cua/@oai/cua-repl/plugin/.codex-plugin/plugin.json'))
  )
})
