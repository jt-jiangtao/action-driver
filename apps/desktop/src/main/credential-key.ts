import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type CredentialKeyOptions = {
  userDataPath: string
  fs?: {
    exists(path: string): boolean
    readFile(path: string): string
    writeFile(path: string, contents: string): void
    mkdir(path: string): void
  }
}

/**
 * Resolves a stable service credential key for one local installation.
 *
 * Key protection is intentionally deferred: the key is stored as plaintext under the user data
 * directory. Transport and storage hardening are tracked in serve-runtime-over-http.
 */
export function resolveCredentialKey(options: CredentialKeyOptions): Buffer {
  const fs = options.fs ?? {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
    mkdir: (path) => {
      mkdirSync(path, { recursive: true })
    }
  }

  const filePath = join(options.userDataPath, 'data', 'credential-secret')
  if (fs.exists(filePath)) {
    const existing = Buffer.from(fs.readFile(filePath).trim(), 'base64')
    if (existing.length === 32) return existing
  }

  const key = randomBytes(32)
  fs.mkdir(dirname(filePath))
  fs.writeFile(filePath, `${key.toString('base64')}\n`)
  return key
}
