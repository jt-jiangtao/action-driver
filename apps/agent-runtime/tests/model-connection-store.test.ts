import type { StoredModelConnection } from '../src/model-connections/store'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openRuntimeDatabase } from '../src/database'
import { createCredentialCipher, createCredentialKey } from '../src/model-connections/credential-cipher'
import { createSqliteModelConnectionStore } from '../src/model-connections/sqlite-store'

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'actiondriver-model-store-')), 'actiondriver.db')
}

const connection: StoredModelConnection = {
  id: 'company-gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKeyCipher: 'cipher-text',
  apiKeyHint: '••••alue',
  expanded: true,
  models: [
    { id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' },
    { id: 'wan2.7-image', name: 'wan2.7-image', enabled: false, testState: 'unsupported' }
  ]
}

describe('service-side model connection storage', () => {
  it('round-trips connections and models through the runtime database', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)

    store.write([connection])
    expect(store.read()).toEqual([connection])

    store.write([])
    expect(store.read()).toEqual([])
    database.close()
  })

  it('replaces the whole list on write so the service stays the only writer', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)

    store.write([connection])
    store.write([{ ...connection, id: 'second', name: '第二个连接' }])

    expect(store.read().map((item) => item.id)).toEqual(['second'])
    database.close()
  })

  it('keeps model order and state per connection', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)

    store.write([connection, { ...connection, id: 'other', models: [] }])

    expect(store.read()[0]!.models.map((model) => model.testState)).toEqual([
      'success',
      'unsupported'
    ])
    expect(store.read()[1]!.models).toEqual([])
    database.close()
  })
})

describe('service-side credential cipher', () => {
  it('encrypts credentials so the plaintext never reaches the store', () => {
    const cipher = createCredentialCipher(createCredentialKey('service-secret'))
    const cipherText = cipher.encrypt('sk-secret-value')

    expect(cipherText).not.toContain('sk-secret-value')
    expect(cipher.decrypt(cipherText)).toBe('sk-secret-value')
    expect(cipher.isAvailable()).toBe(true)
  })

  it('derives a stable key and rejects unusable keys', () => {
    expect(createCredentialKey('a').equals(createCredentialKey('a'))).toBe(true)
    expect(createCredentialKey('b').equals(createCredentialKey('a'))).toBe(false)
    expect(() => createCredentialKey('  ')).toThrow()
    expect(createCredentialCipher(Buffer.alloc(4)).isAvailable()).toBe(false)
    expect(() => createCredentialCipher(Buffer.alloc(4)).encrypt('x')).toThrow()
  })

  it('fails loudly when the ciphertext is tampered with', () => {
    const cipher = createCredentialCipher(createCredentialKey('service-secret'))
    const cipherText = Buffer.from(cipher.encrypt('sk-secret-value'), 'base64')
    cipherText[cipherText.length - 1] = cipherText[cipherText.length - 1]! ^ 0xff

    expect(() => cipher.decrypt(cipherText.toString('base64'))).toThrow()
  })
})
