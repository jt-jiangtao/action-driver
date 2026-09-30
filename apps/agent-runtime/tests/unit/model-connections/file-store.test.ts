import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileModelConnectionStore } from '../../../src/model-connections/file-store'
import { ModelStorageError, type StoredModelConnection } from '../../../src/model-connections/store'

const temporaryDirectories: string[] = []

function configPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-model-file-'))
  temporaryDirectories.push(directory)
  return join(directory, 'model-connections.json')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function connection(overrides: Partial<StoredModelConnection> = {}): StoredModelConnection {
  return {
    id: 'connection-1',
    name: 'Local',
    protocol: 'openai-compatible',
    baseUrl: 'https://example.test',
    apiKeyCipher: 'cipher-text',
    apiKeyHint: 'sk-…1234',
    expanded: true,
    models: [
      {
        id: 'image-model',
        name: 'Image',
        enabled: true,
        testState: 'success',
        kind: 'image',
        imageInputEnabled: false,
        imageGenerationEnabled: true,
        imageGenerationApi: 'openai-images',
        capabilities: { image_generation: { state: 'success', source: 'probe' } }
      }
    ],
    ...overrides
  }
}

describe('file model connection store', () => {
  it('reads nothing from a missing config file', () => {
    const store = createFileModelConnectionStore({ filePath: configPath() })
    expect(store.read()).toEqual([])
    expect(store.readDefaultImageModel()).toBeNull()
  })

  it('round-trips connections and keeps the encrypted key out of the database', () => {
    const filePath = configPath()
    const store = createFileModelConnectionStore({ filePath })
    store.write([connection()])
    expect(store.read()).toEqual([connection()])
    const raw = readFileSync(filePath, 'utf8')
    expect(raw).toContain('cipher-text')
    // The config carries credential material, so it must not be world readable.
    expect(statSync(filePath).mode & 0o077).toBe(0)
  })

  it('keeps the default image model only while its model stays usable', () => {
    const filePath = configPath()
    const store = createFileModelConnectionStore({ filePath })
    store.write([connection()])
    store.writeDefaultImageModel({ connectionId: 'connection-1', modelId: 'image-model' })
    expect(store.readDefaultImageModel()).toEqual({
      connectionId: 'connection-1',
      modelId: 'image-model'
    })

    store.write([connection({ models: [] })])
    expect(store.readDefaultImageModel()).toBeNull()
  })

  it('reports unreadable config instead of silently resetting it', () => {
    const filePath = configPath()
    writeFileSync(filePath, '{ not json')
    const store = createFileModelConnectionStore({ filePath })
    expect(() => store.read()).toThrow(ModelStorageError)
  })
})
