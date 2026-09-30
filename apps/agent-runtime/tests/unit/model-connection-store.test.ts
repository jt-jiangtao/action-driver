import type { StoredModelConnection } from '../../src/model-connections/store'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RUNTIME_MIGRATIONS, openRuntimeDatabase } from '../../src/database'
import {
  createCredentialCipher,
  createCredentialKey
} from '../../src/model-connections/credential-cipher'
import { createSqliteModelConnectionStore } from '../../src/model-connections/sqlite-store'

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'action-driver-model-store-')), 'action-driver.db')
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
    {
      id: 'qwen3.7-plus',
      name: 'qwen3.7-plus',
      enabled: true,
      testState: 'success',
      kind: 'chat',
      imageInputEnabled: false,
      imageGenerationEnabled: false,
      imageGenerationApi: 'openai-images'
    },
    {
      id: 'wan2.7-image',
      name: 'wan2.7-image',
      enabled: false,
      testState: 'unsupported',
      kind: 'image',
      imageInputEnabled: false,
      imageGenerationEnabled: false,
      imageGenerationApi: 'token-plan'
    }
  ]
}

describe('service-side model connection storage', () => {
  it('keeps the unique image default after a model rewrite and clears it when removed', () => {
    const path = databasePath()
    const database = openRuntimeDatabase(path)
    const store = createSqliteModelConnectionStore(database)
    const configured = {
      ...connection,
      models: connection.models.map((model) =>
        model.id === 'wan2.7-image'
          ? { ...model, enabled: true, imageGenerationEnabled: false }
          : model
      )
    }
    store.write([configured])
    store.writeDefaultImageModel({ connectionId: configured.id, modelId: 'wan2.7-image' })
    store.write([configured])
    expect(store.readDefaultImageModel()).toEqual({
      connectionId: configured.id,
      modelId: 'wan2.7-image'
    })
    database.close()
    const reopened = openRuntimeDatabase(path)
    const afterRestart = createSqliteModelConnectionStore(reopened)
    expect(afterRestart.readDefaultImageModel()?.modelId).toBe('wan2.7-image')
    afterRestart.write([])
    expect(afterRestart.readDefaultImageModel()).toBeNull()
    reopened.close()
  })

  it('preserves a verified image default even when the old kind is chat', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)
    const dual = {
      ...connection,
      models: [
        {
          ...connection.models[0]!,
          kind: 'chat' as const,
          capabilities: {
            image_generation: { state: 'success' as const, source: 'probe' as const }
          }
        }
      ]
    }
    store.write([dual])
    store.writeDefaultImageModel({ connectionId: dual.id, modelId: 'qwen3.7-plus' })
    store.write([dual])
    expect(store.readDefaultImageModel()).toEqual({
      connectionId: dual.id,
      modelId: 'qwen3.7-plus'
    })
    database.close()
  })

  it('migrates model image capability flags and a nullable default image model', () => {
    const database = openRuntimeDatabase(databasePath())
    const columns = database.prepare('PRAGMA table_info(model_connection_models)').all() as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).toContain('image_input_enabled')
    expect(columns.map((column) => column.name)).toContain('image_generation_enabled')
    expect(columns.map((column) => column.name)).toContain('image_generation_api')
    const defaultRows = database
      .prepare('SELECT connection_id, model_id FROM default_image_model')
      .all()
    expect(defaultRows).toEqual([])
    database.close()
  })

  it('round-trips connections and models through the runtime database', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)

    store.write([connection])
    expect(store.read()[0]?.models[0]?.capabilities).toEqual({
      text: { state: 'untested', source: 'catalog' },
      reasoning: { state: 'untested', source: 'catalog' },
      vision: { state: 'untested', source: 'catalog' },
      image_generation: { state: 'untested', source: 'catalog' }
    })
    expect(store.read()[0]?.id).toBe(connection.id)

    store.write([])
    expect(store.read()).toEqual([])
    database.close()
  })

  it('migrates a v9 image model without changing its default selection', () => {
    const path = databasePath()
    const old = openRuntimeDatabase(path, DEFAULT_RUNTIME_MIGRATIONS.slice(0, 9))
    old
      .prepare(
        `INSERT INTO model_connections
       (id, name, protocol, base_url, api_key_cipher, api_key_hint, expanded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, '2026-01-01', '2026-01-01')`
      )
      .run(
        connection.id,
        connection.name,
        connection.protocol,
        connection.baseUrl,
        connection.apiKeyCipher,
        connection.apiKeyHint
      )
    old
      .prepare(
        `INSERT INTO model_connection_models
       (connection_id, model_id, name, enabled, test_state, position,
        image_input_enabled, image_generation_enabled)
       VALUES (?, 'qwen3.7-plus', 'qwen3.7-plus', 1, 'success', 0, 0, 0)`
      )
      .run(connection.id)
    old
      .prepare(
        `INSERT INTO default_image_model (singleton, connection_id, model_id)
       VALUES (1, ?, 'qwen3.7-plus')`
      )
      .run(connection.id)
    old.close()

    const upgraded = openRuntimeDatabase(path)
    const store = createSqliteModelConnectionStore(upgraded)
    expect(store.read()[0]?.models[0]?.imageGenerationApi).toBe('openai-images')
    expect(store.read()[0]?.models[0]?.kind).toBe('image')
    expect(store.read()[0]?.models[0]?.capabilities?.text).toEqual({
      state: 'untested',
      source: 'legacy'
    })
    expect(store.read()[0]?.models[0]?.capabilities?.image_generation).toEqual({
      state: 'untested',
      source: 'legacy'
    })
    expect(store.readDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'qwen3.7-plus'
    })
    store.write(store.read())
    expect(store.readDefaultImageModel()).toEqual({
      connectionId: connection.id,
      modelId: 'qwen3.7-plus'
    })
    upgraded.close()
  })

  it('replaces the whole list on write so the service stays the only writer', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)

    store.write([connection])
    store.write([{ ...connection, id: 'second', name: '第二个连接' }])

    expect(store.read().map((item) => item.id)).toEqual(['second'])
    database.close()
  })

  it('persists one tested capability without changing another model', () => {
    const database = openRuntimeDatabase(databasePath())
    const store = createSqliteModelConnectionStore(database)
    store.write([connection])
    const saved = store.read()[0]!
    saved.models[0]!.capabilities = {
      ...saved.models[0]!.capabilities,
      vision: { state: 'success', source: 'probe', testedAt: '2026-09-25T00:00:00Z' }
    }
    store.write([saved])
    const after = store.read()[0]!
    expect(after.models[0]?.capabilities?.vision).toEqual({
      state: 'success',
      source: 'probe',
      testedAt: '2026-09-25T00:00:00Z'
    })
    expect(after.models[1]?.capabilities?.vision).toEqual({
      state: 'untested',
      source: 'catalog'
    })
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
