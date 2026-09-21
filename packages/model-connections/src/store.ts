import type { ModelOptionDto, ModelProtocol } from './types'

export type StoredModelConnection = {
  id: string
  name: string
  protocol: ModelProtocol
  baseUrl: string
  apiKeyCipher: string
  apiKeyHint: string
  expanded: boolean
  models: ModelOptionDto[]
}

export interface ModelConnectionStore {
  read(): StoredModelConnection[]
  write(connections: readonly StoredModelConnection[]): void
}

export class ModelStorageError extends Error {
  readonly code = 'MODEL_STORAGE_ERROR'

  constructor(message: string, options?: { cause?: unknown }) {
    super(`MODEL_STORAGE_ERROR: ${message}`, options)
    this.name = 'ModelStorageError'
  }
}
