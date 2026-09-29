// @vitest-environment node
import { expect, test } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureBaseline } from '../../src/baseline'
import { generateReadable } from '../../src/readable'
test('readable output leaves source unchanged and rejects unsafe layouts', async () => {
  const r = await mkdtemp(join(tmpdir(), 'cua-readable-'))
  const source = join(r, 'source')
  await mkdir(source)
  try {
    await writeFile(join(source, 'a.js'), 'export const a=1;')
    const b = await captureBaseline(source)
    await generateReadable(source, join(r, 'output'), b)
    expect(await readFile(join(source, 'a.js'), 'utf8')).toBe('export const a=1;')
    expect(await readFile(join(r, 'output/a.js'), 'utf8')).toContain('export const a = 1')
    await expect(generateReadable(source, join(source, 'nested'), b)).rejects.toThrow()
    await expect(
      generateReadable(source, join(r, 'bad'), {
        ...b,
        files: [{ path: '../escape', kind: 'directory' }]
      })
    ).rejects.toThrow()
    await symlink(source, join(r, 'link'))
    await expect(generateReadable(source, join(r, 'link/nested'), b)).rejects.toThrow()
  } finally {
    await rm(r, { recursive: true, force: true })
  }
})
