import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCredentialKey } from './credential-key'

function reversibleCipher() {
  const prefix = 'cipher:'
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`${prefix}${plainText}`),
    decryptString: (encrypted: Buffer) => encrypted.toString().replace(new RegExp(`^${prefix}`), '')
  }
}

describe('credential key resolution', () => {
  it('generates once and reads the same stable key on the next start', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'actiondriver-cred-'))
    const cipher = reversibleCipher()

    const first = resolveCredentialKey({ userDataPath, cipher })
    const second = resolveCredentialKey({ userDataPath, cipher })

    expect(first.length).toBe(32)
    expect(second.equals(first)).toBe(true)
  })

  it('refuses to generate a key when OS encryption is unavailable', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'actiondriver-cred-'))
    expect(() =>
      resolveCredentialKey({
        userDataPath,
        cipher: { ...reversibleCipher(), isEncryptionAvailable: () => false }
      })
    ).toThrow('MODEL_SECRET_UNAVAILABLE')
  })
})
