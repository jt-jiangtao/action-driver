import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRuntimeStorage } from '../../src/runtime-storage'

describe('runtime storage assembly', () => {
  it('releases ownership when assembly fails after opening the state database', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'action-driver-storage-error-'))
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'action-driver-storage-error-workspace-'))
    await expect(
      createRuntimeStorage({
        dataRoot,
        workspaceRoot,
        environment: { ACTION_DRIVER_RESOURCE_REMOTE_HOSTS: 'not-json' }
      })
    ).rejects.toThrow('must be valid JSON')
    const recovered = await createRuntimeStorage({ dataRoot, workspaceRoot, environment: {} })
    await recovered.close()
  }, 20_000)

  it('removes legacy files and releases ownership for the next startup', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'action-driver-storage-'))
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'action-driver-storage-workspace-'))
    writeFileSync(join(dataRoot, 'action-driver.db'), 'legacy')
    const first = await createRuntimeStorage({ dataRoot, workspaceRoot, environment: {} })
    expect(existsSync(join(dataRoot, 'action-driver.db'))).toBe(false)
    expect(existsSync(join(dataRoot, 'state.sqlite'))).toBe(true)
    await first.close()
    const second = await createRuntimeStorage({ dataRoot, workspaceRoot, environment: {} })
    await second.close()
  }, 20_000)
})
