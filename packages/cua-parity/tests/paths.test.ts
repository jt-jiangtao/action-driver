// @vitest-environment node
import { expect, test } from 'vitest'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertOutputOutside } from '../src/paths'
test('outputs cannot overwrite vendor or protected inputs, including linked paths', async () => {
  const r = await mkdtemp(join(tmpdir(), 'cua-paths-'))
  try {
    const vendor = join(r, 'vendor')
    await mkdir(vendor)
    await symlink(vendor, join(r, 'link'))
    await expect(assertOutputOutside(vendor, join(vendor, 'out'), [])).rejects.toThrow()
    await expect(assertOutputOutside(vendor, join(r, 'link/out'), [])).rejects.toThrow()
    await expect(
      assertOutputOutside(vendor, join(r, 'baseline'), [join(r, 'baseline')])
    ).rejects.toThrow()
    await expect(assertOutputOutside(vendor, join(r, 'out'), [])).resolves.toBeUndefined()
  } finally {
    await rm(r, { recursive: true, force: true })
  }
})
