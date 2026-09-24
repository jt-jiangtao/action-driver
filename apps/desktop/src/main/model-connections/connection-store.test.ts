import { describe, expect, it } from 'vitest'
import type { ModelOptionDto } from '@actiondriver/model-connections'
import {
  ModelStorageError,
  createModelConnectionStore,
  type FileSystemPort,
  type StoredModelConnection
} from './connection-store'
import { SecretCipherUnavailableError, apiKeyHint, createSecretCipher } from './secret-cipher'

function memoryFileSystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const fs: FileSystemPort = {
    exists: (path) => files.has(path),
    readFile: (path) => {
      const contents = files.get(path)
      if (contents === undefined) throw new Error(`ENOENT: ${path}`)
      return contents
    },
    writeFile: (path, contents) => {
      files.set(path, contents)
    },
    mkdir: () => undefined,
    rename: (from, to) => {
      const contents = files.get(from)
      if (contents === undefined) throw new Error(`ENOENT: ${from}`)
      files.set(to, contents)
      files.delete(from)
    }
  }
  return { fs, files }
}

const models: ModelOptionDto[] = [
  { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'untested' }
]

const connection: StoredModelConnection = {
  id: 'company-gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKeyCipher: Buffer.from('sk-secret-value').toString('base64'),
  apiKeyHint: apiKeyHint('sk-secret-value'),
  expanded: true,
  models
}

describe('model connection store', () => {
  it('writes atomically and reads the stored connections back', () => {
    const { fs, files } = memoryFileSystem()
    const store = createModelConnectionStore({ filePath: '/data/model-connections.json', fs })

    store.write([connection])

    expect(files.has('/data/model-connections.json.tmp')).toBe(false)
    expect(store.read()).toEqual([connection])
  })

  it('treats a missing file as an empty list and reports unreadable contents', () => {
    const empty = createModelConnectionStore({ filePath: '/data/none.json', fs: memoryFileSystem().fs })
    expect(empty.read()).toEqual([])

    const broken = createModelConnectionStore({
      filePath: '/data/model-connections.json',
      fs: memoryFileSystem({ '/data/model-connections.json': '{not json' }).fs
    })
    expect(() => broken.read()).toThrowError(ModelStorageError)
  })

  it('stores API keys as ciphertext with a masked hint', () => {
    const stored = JSON.stringify({
      version: 1,
      connections: [
        {
          ...connection,
          apiKeyCipher: createSecretCipher(fakeSafeStorage()).encrypt('sk-secret-value')
        }
      ]
    })

    expect(stored).not.toContain('sk-secret-value')
    expect(apiKeyHint('sk-secret-value')).toBe('••••alue')
    expect(apiKeyHint('ab')).toBe('••••')
  })

  it('refuses to encrypt when OS encryption is unavailable', () => {
    const cipher = createSecretCipher({ ...fakeSafeStorage(), isEncryptionAvailable: () => false })

    expect(() => cipher.encrypt('sk-secret-value')).toThrowError(SecretCipherUnavailableError)
  })
})

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`cipher:${plainText}`),
    decryptString: (encrypted: Buffer) => encrypted.toString().replace(/^cipher:/, '')
  }
}
