import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCredentialKey } from '../../../src/main/credential-key'

describe('credential key resolution', () => {
  it('generates once and reads the same stable key on the next start', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'action-driver-cred-'))

    const first = resolveCredentialKey({ userDataPath })
    const second = resolveCredentialKey({ userDataPath })

    expect(first.length).toBe(32)
    expect(second.equals(first)).toBe(true)
  })

  it('replaces a corrupt key with a fresh one', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'action-driver-cred-'))
    const directory = join(userDataPath, 'data')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'credential-secret'), 'v10-corrupt-value')

    expect(resolveCredentialKey({ userDataPath }).length).toBe(32)
  })
})
