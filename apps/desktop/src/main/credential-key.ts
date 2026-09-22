import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SecretCipherLike = {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type CredentialKeyOptions = {
  userDataPath: string
  cipher: SecretCipherLike
  fs?: {
    exists(path: string): boolean
    readFile(path: string): Buffer
    writeFile(path: string, contents: Buffer): void
    mkdir(path: string): void
  }
}

/**
 * Resolves a stable service credential key for one local installation.
 *
 * The key is generated once and persisted encrypted with the OS keychain. The plaintext key is
 * returned so the Main process can hand it to the local service. Key transport hardening is a
 * deferred concern (see serve-runtime-over-http Battle Status).
 */
export function resolveCredentialKey(options: CredentialKeyOptions): Buffer {
  const fs = options.fs ?? {
    exists: existsSync,
    readFile: (path) => readFileSync(path),
    writeFile: (path, contents) => writeFileSync(path, contents),
    mkdir: (path) => {
      mkdirSync(path, { recursive: true })
    }
  }

  if (!options.cipher.isEncryptionAvailable()) {
    throw new Error('MODEL_SECRET_UNAVAILABLE: OS encryption is unavailable')
  }

  const filePath = join(options.userDataPath, 'data', 'credential-secret')
  if (fs.exists(filePath)) {
    return Buffer.from(options.cipher.decryptString(fs.readFile(filePath)), 'base64')
  }

  const key = randomBytes(32)
  fs.mkdir(dirname(filePath))
  fs.writeFile(filePath, options.cipher.encryptString(key.toString('base64')))
  return key
}
