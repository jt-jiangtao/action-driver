import {
  ModelStorageError,
  type ModelConnectionStore,
  type StoredModelConnection
} from '@actiondriver/model-connections'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export { ModelStorageError }
export type { ModelConnectionStore, StoredModelConnection }

export type FileSystemPort = {
  exists(path: string): boolean
  readFile(path: string): string
  writeFile(path: string, contents: string): void
  mkdir(path: string): void
  rename(from: string, to: string): void
}

const STORE_VERSION = 1

export function createNodeFileSystem(): FileSystemPort {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, contents) => writeFileSync(path, contents, 'utf8'),
    mkdir: (path) => {
      mkdirSync(path, { recursive: true })
    },
    rename: (from, to) => {
      renameSync(from, to)
    }
  }
}

export function createModelConnectionStore(options: {
  filePath: string
  fs: FileSystemPort
}): ModelConnectionStore {
  const { filePath, fs } = options

  return {
    read() {
      if (!fs.exists(filePath)) return []
      let payload: unknown
      try {
        payload = JSON.parse(fs.readFile(filePath))
      } catch (error) {
        throw new ModelStorageError(`Cannot read ${filePath}`, { cause: error })
      }
      if (!isStorePayload(payload)) {
        throw new ModelStorageError(`Unexpected contents in ${filePath}`)
      }
      return payload.connections.map((connection) => ({
        ...connection,
        models: [...connection.models]
      }))
    },
    write(connections) {
      try {
        fs.mkdir(dirname(filePath))
        const temporaryPath = `${filePath}.tmp`
        fs.writeFile(
          temporaryPath,
          `${JSON.stringify({ version: STORE_VERSION, connections }, null, 2)}\n`
        )
        fs.rename(temporaryPath, filePath)
      } catch (error) {
        throw new ModelStorageError(`Cannot write ${filePath}`, { cause: error })
      }
    }
  }
}

function isStorePayload(value: unknown): value is {
  version: number
  connections: StoredModelConnection[]
} {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as { version?: unknown; connections?: unknown }
  if (payload.version !== STORE_VERSION) return false
  if (!Array.isArray(payload.connections)) return false
  return payload.connections.every(isStoredConnection)
}

function isStoredConnection(value: unknown): value is StoredModelConnection {
  if (typeof value !== 'object' || value === null) return false
  const connection = value as Record<string, unknown>
  return (
    typeof connection.id === 'string' &&
    typeof connection.name === 'string' &&
    (connection.protocol === 'openai-compatible' || connection.protocol === 'anthropic') &&
    typeof connection.baseUrl === 'string' &&
    typeof connection.apiKeyCipher === 'string' &&
    typeof connection.apiKeyHint === 'string' &&
    typeof connection.expanded === 'boolean' &&
    Array.isArray(connection.models)
  )
}
