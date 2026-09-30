import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelRef } from '@actiondriver/contracts'
import { ModelStorageError, type ModelConnectionStore, type StoredModelConnection } from './store'

export type FileModelConnectionStoreOptions = {
  /** The config file that holds connections and the default image model. */
  filePath: string
  now?: () => string
}

type ConfigFile = {
  version: 1
  updatedAt: string
  defaultImageModel: ModelRef | null
  connections: StoredModelConnection[]
}

/**
 * Model connections live in a file rather than the runtime database, so credentials and endpoints
 * stay portable and the database keeps only session-adjacent state. Writes replace the file
 * atomically and are readable only by the owning user.
 */
export function createFileModelConnectionStore(
  options: FileModelConnectionStoreOptions
): ModelConnectionStore {
  const now = options.now ?? (() => new Date().toISOString())
  const empty = (): ConfigFile => ({
    version: 1,
    updatedAt: now(),
    defaultImageModel: null,
    connections: []
  })

  const readFile = (): ConfigFile => {
    let raw: string
    try {
      raw = readFileSync(options.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      throw new ModelStorageError('Cannot read model connections', { cause: error })
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ConfigFile>
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now(),
        defaultImageModel: parsed.defaultImageModel ?? null,
        connections: Array.isArray(parsed.connections) ? parsed.connections : []
      }
    } catch (error) {
      throw new ModelStorageError('Cannot read model connections', { cause: error })
    }
  }

  const writeFile = (config: ConfigFile): void => {
    const next = { ...config, version: 1 as const, updatedAt: now() }
    const temporary = `${options.filePath}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(options.filePath), { recursive: true })
      // 0600: the encrypted key material must not be world readable.
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, options.filePath)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw new ModelStorageError('Cannot write model connections', { cause: error })
    }
  }

  const stillSelected = (
    connections: readonly StoredModelConnection[],
    previous: ModelRef | null
  ): ModelRef | null => {
    if (!previous) return null
    const selected = connections
      .find((connection) => connection.id === previous.connectionId)
      ?.models.find((model) => model.id === previous.modelId)
    if (!selected?.enabled) return null
    const capability = selected.capabilities?.image_generation
    const usable = capability
      ? capability.state === 'success' ||
        (capability.state === 'untested' && capability.source === 'legacy')
      : selected.kind === 'image'
    return usable ? previous : null
  }

  return {
    read() {
      return readFile().connections
    },
    write(connections) {
      const config = readFile()
      writeFile({
        ...config,
        connections: [...connections],
        defaultImageModel: stillSelected(connections, config.defaultImageModel)
      })
    },
    readDefaultImageModel() {
      return readFile().defaultImageModel
    },
    writeDefaultImageModel(model) {
      writeFile({ ...readFile(), defaultImageModel: model })
    }
  }
}
