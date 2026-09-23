import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SandboxPathGuard } from '../src/sandbox/path-guard'

describe('SandboxPathGuard', () => {
  it('resolves only existing paths within the configured workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-sandbox-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'actiondriver-sandbox-outside-'))
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested', 'file.txt'), 'inside')
    await writeFile(join(outside, 'secret.txt'), 'outside')
    await symlink(join(root, 'nested', 'file.txt'), join(root, 'inside-link'))
    await symlink(join(outside, 'secret.txt'), join(root, 'outside-link'))
    const guard = await SandboxPathGuard.create(root)

    await expect(guard.resolveExisting('nested/file.txt')).resolves.toMatchObject({
      relativePath: 'nested/file.txt'
    })
    await expect(guard.resolveExisting('inside-link')).resolves.toMatchObject({
      relativePath: 'nested/file.txt'
    })
    for (const path of [join(root, 'nested/file.txt'), '../secret.txt', 'outside-link', '', 'missing']) {
      await expect(guard.resolveExisting(path)).rejects.toThrow('SANDBOX_PATH_DENIED')
    }
  })

  it('fails when the configured root does not exist', async () => {
    await expect(SandboxPathGuard.create('/nonexistent/actiondriver-workspace')).rejects.toThrow(
      'SANDBOX_ROOT_INVALID'
    )
  })
})
