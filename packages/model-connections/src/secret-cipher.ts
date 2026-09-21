export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plainText: string): string
  decrypt(cipherText: string): string
}

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export class SecretCipherUnavailableError extends Error {
  readonly code = 'MODEL_SECRET_UNAVAILABLE'

  constructor() {
    super(
      'MODEL_SECRET_UNAVAILABLE: OS encryption is unavailable; refusing to store a plaintext API key'
    )
    this.name = 'SecretCipherUnavailableError'
  }
}

export function createSecretCipher(safeStorage: SafeStorageLike): SecretCipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt(plainText) {
      if (!safeStorage.isEncryptionAvailable()) throw new SecretCipherUnavailableError()
      return safeStorage.encryptString(plainText).toString('base64')
    },
    decrypt(cipherText) {
      if (!safeStorage.isEncryptionAvailable()) throw new SecretCipherUnavailableError()
      return safeStorage.decryptString(Buffer.from(cipherText, 'base64'))
    }
  }
}

export function apiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim()
  if (trimmed.length <= 4) return '••••'
  return `••••${trimmed.slice(-4)}`
}
