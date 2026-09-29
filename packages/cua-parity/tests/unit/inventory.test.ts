// @vitest-environment node
import { expect, test } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureBaseline } from '../../src/baseline'
import { inventory } from '../../src/inventory'
test('maps every file, identifies identical bytes, retains unknowns and dependency evidence', async () => {
  const r = await mkdtemp(join(tmpdir(), 'cua-inventory-'))
  try {
    const path = '@oai/cua/dist/lib/js/oai_js_core/src'
    await mkdir(join(r, path), { recursive: true })
    await writeFile(join(r, path, 'a.js'), 'export const value=1')
    await writeFile(join(r, path, 'b.js'), 'export const value=1')
    await writeFile(join(r, 'unknown.js'), 'import(variable)')
    await mkdir(join(r, 'node_modules/example'), { recursive: true })
    await writeFile(
      join(r, 'node_modules/example/package.json'),
      JSON.stringify({ name: 'example', version: '1.2.3' })
    )
    await writeFile(join(r, 'node_modules/example/index.js'), 'export {}')
    const b = await captureBaseline(r)
    const items = await inventory(r, b)
    expect(items).toHaveLength(b.files.length)
    expect(items.find((f) => f.path.endsWith('/b.js'))?.duplicateOf).toBe(path + '/a.js')
    expect(items.find((f) => f.path === 'unknown.js')?.classification).toBe('unknown')
    expect(items.find((f) => f.path.endsWith('example/index.js'))?.evidence.join(' ')).toContain(
      'example@1.2.3'
    )
    expect(items.find((f) => f.path.endsWith('/a.js'))?.exports).toContain('value')
  } finally {
    await rm(r, { recursive: true, force: true })
  }
})
