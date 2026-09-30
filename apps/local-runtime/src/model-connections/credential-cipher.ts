import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plainText: string): string
  decrypt(cipherText: string): string
}

export class SecretCipherUnavailableError extends Error {
  readonly code = 'MODEL_SECRET_UNAVAILABLE'
  constructor() {
    super('MODEL_SECRET_UNAVAILABLE: credential encryption is unavailable')
    this.name = 'SecretCipherUnavailableError'
  }
}

export function apiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim()
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`
}

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

/**
 * Derives a stable 32 byte key from a service credential secret. The local assembly receives the
 * secret from Electron Main (which protects it with the OS keychain); a cloud assembly would use a
 * managed key instead.
 */
export function createCredentialKey(secret: string): Buffer {
  const trimmed = secret.trim()
  if (!trimmed) throw new SecretCipherUnavailableError()
  return createHash('sha256').update(trimmed).digest()
}

export function createCredentialCipher(key: Buffer): SecretCipher {
  return {
    isAvailable: () => key.length === KEY_BYTES,
    encrypt(plainText) {
      if (key.length !== KEY_BYTES) throw new SecretCipherUnavailableError()
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
    },
    decrypt(cipherText) {
      if (key.length !== KEY_BYTES) throw new SecretCipherUnavailableError()
      try {
        const payload = Buffer.from(cipherText, 'base64')
        const iv = payload.subarray(0, IV_BYTES)
        const tag = payload.subarray(IV_BYTES, IV_BYTES + 16)
        const ciphertext = payload.subarray(IV_BYTES + 16)
        const decipher = createDecipheriv(ALGORITHM, key, iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
      } catch (error) {
        throw new Error(
          `Credential could not be decrypted: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
}
