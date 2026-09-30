import type { ModelOptionDto, ModelProtocol } from '@action-driver/model-connections'
import type { ModelRef } from '@action-driver/contracts'

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
  readDefaultImageModel(): ModelRef | null
  writeDefaultImageModel(model: ModelRef | null): void
}

export class ModelStorageError extends Error {
  readonly code = 'MODEL_STORAGE_ERROR'

  constructor(message: string, options?: { cause?: unknown }) {
    super(`MODEL_STORAGE_ERROR: ${message}`, options)
    this.name = 'ModelStorageError'
  }
}
