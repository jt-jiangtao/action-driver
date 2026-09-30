import { describe, expect, it } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('office dependency staging', () => {
  it('copies the source layout and symlinks without modifying the source', async () => {
    const { stageOfficeDependencies } = await import('../../scripts/stage-office-dependencies.mjs')
    const root = await mkdtemp(join(tmpdir(), 'action-driver-office-stage-'))
    const source = join(root, 'source')
    const target = join(root, 'dist', 'dependencies')
    for (const dir of ['bin/override', 'native', 'node/bin', 'node/node_modules', 'python/bin']) {
      await mkdir(join(source, dir), { recursive: true })
    }
    for (const relative of ['bin/override/soffice', 'bin/override/pdftoppm', 'node/bin/node', 'python/bin/python3.12']) {
      const path = join(source, relative)
      await writeFile(path, 'bundled')
      await chmod(path, 0o755)
    }
    await symlink('python3.12', join(source, 'python/bin/python3'))
    await writeFile(join(source, 'node/node_modules', 'package.json'), '{}')

    await stageOfficeDependencies(source, target)

    expect(await readFile(join(target, 'node/node_modules/package.json'), 'utf8')).toBe('{}')
    expect((await lstat(join(target, 'python/bin/python3'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(target, 'python/bin/python3'))).toBe('python3.12')
    expect(await readFile(join(source, 'python/bin/python3.12'), 'utf8')).toBe('bundled')
    await expect(stageOfficeDependencies(join(root, 'missing'), target)).rejects.toThrow('OFFICE_DEPENDENCIES_SOURCE_UNAVAILABLE')
    expect(await readFile(join(target, 'python/bin/python3.12'), 'utf8')).toBe('bundled')
  })
})
