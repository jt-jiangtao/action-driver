import type {
  ModelCapability,
  ModelCapabilityResultDto,
  ModelFailureCode,
  ModelOptionDto,
  ModelProtocol,
  ModelTestState
} from '@actiondriver/model-connections'
import type { ModelConnectionStore, StoredModelConnection } from './store'
import { ModelStorageError } from './store'
import type Database from 'better-sqlite3'
import type { ModelRef } from '@actiondriver/contracts'

type ConnectionRow = {
  id: string
  name: string
  protocol: string
  base_url: string
  api_key_cipher: string
  api_key_hint: string
  expanded: number
}

type ModelRow = {
  connection_id: string
  model_id: string
  name: string
  enabled: number
  test_state: string
  image_input_enabled: number
  image_generation_enabled: number
  image_generation_api: string
  model_kind: string
}

type CapabilityRow = {
  connection_id: string
  model_id: string
  capability: ModelCapability
  state: ModelCapabilityResultDto['state']
  source: ModelCapabilityResultDto['source']
  tested_at: string | null
  failure_code: string | null
  failure_message: string | null
}

const CAPABILITIES: readonly ModelCapability[] = ['text', 'reasoning', 'vision', 'image_generation']

/** Stores model connections in the runtime database so the service is their only writer. */
export function createSqliteModelConnectionStore(
  database: Database.Database,
  now: () => string = () => new Date().toISOString()
): ModelConnectionStore {
  return {
    read() {
      try {
        const connections = database
          .prepare(
            `SELECT id, name, protocol, base_url, api_key_cipher, api_key_hint, expanded
             FROM model_connections ORDER BY rowid`
          )
          .all() as ConnectionRow[]
        const models = database
          .prepare(
            `SELECT connection_id, model_id, name, enabled, test_state,
                    image_input_enabled, image_generation_enabled, image_generation_api, model_kind
             FROM model_connection_models ORDER BY connection_id, position`
          )
          .all() as ModelRow[]
        const results = database
          .prepare(
            `SELECT connection_id, model_id, capability, state, source, tested_at,
                    failure_code, failure_message
             FROM model_capability_results`
          )
          .all() as CapabilityRow[]

        return connections.map((connection) => ({
          id: connection.id,
          name: connection.name,
          protocol: toProtocol(connection.protocol),
          baseUrl: connection.base_url,
          apiKeyCipher: connection.api_key_cipher,
          apiKeyHint: connection.api_key_hint,
          expanded: connection.expanded === 1,
          models: models
            .filter((model) => model.connection_id === connection.id)
            .map((model) =>
              toModel(
                model,
                results.filter(
                  (result) =>
                    result.connection_id === model.connection_id &&
                    result.model_id === model.model_id
                )
              )
            )
        }))
      } catch (error) {
        throw new ModelStorageError('Cannot read model connections', { cause: error })
      }
    },
    write(connections) {
      try {
        const replace = database.transaction((next: readonly StoredModelConnection[]) => {
          const previousDefault = readDefault(database)
          database.prepare('DELETE FROM default_image_model').run()
          database.prepare('DELETE FROM model_connection_models').run()
          database.prepare('DELETE FROM model_connections').run()
          const insertConnection = database.prepare(
            `INSERT INTO model_connections
               (id, name, protocol, base_url, api_key_cipher, api_key_hint, expanded, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          const insertModel = database.prepare(
            `INSERT INTO model_connection_models
               (connection_id, model_id, name, enabled, test_state, position,
                image_input_enabled, image_generation_enabled, image_generation_api, model_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          const insertCapability = database.prepare(
            `INSERT INTO model_capability_results
               (connection_id, model_id, capability, state, source, tested_at,
                failure_code, failure_message)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          const timestamp = now()
          for (const connection of next) {
            insertConnection.run(
              connection.id,
              connection.name,
              connection.protocol,
              connection.baseUrl,
              connection.apiKeyCipher,
              connection.apiKeyHint,
              connection.expanded ? 1 : 0,
              timestamp,
              timestamp
            )
            connection.models.forEach((model, index) => {
              insertModel.run(
                connection.id,
                model.id,
                model.name,
                model.enabled ? 1 : 0,
                model.testState,
                index,
                model.imageInputEnabled ? 1 : 0,
                model.imageGenerationEnabled ? 1 : 0,
                model.imageGenerationApi ?? 'openai-images',
                model.kind ?? (model.imageGenerationEnabled ? 'image' : 'chat')
              )
              for (const capability of CAPABILITIES) {
                const result = model.capabilities?.[capability] ?? {
                  state: 'untested',
                  source: 'catalog'
                }
                insertCapability.run(
                  connection.id,
                  model.id,
                  capability,
                  result.state,
                  result.source,
                  result.testedAt ?? null,
                  result.failure?.code ?? null,
                  result.failure?.message ?? null
                )
              }
            })
          }
          const selected = next
            .find((connection) => connection.id === previousDefault?.connectionId)
            ?.models.find((model) => model.id === previousDefault?.modelId)
          if (
            previousDefault &&
            selected?.enabled &&
            (selected.capabilities?.image_generation
              ? selected.capabilities.image_generation.state === 'success' ||
                (selected.capabilities.image_generation.state === 'untested' &&
                  selected.capabilities.image_generation.source === 'legacy')
              : selected.kind === 'image')
          ) {
            database
              .prepare(
                `INSERT INTO default_image_model
              (singleton, connection_id, model_id) VALUES (1, ?, ?)`
              )
              .run(previousDefault.connectionId, previousDefault.modelId)
          }
        })
        replace(connections)
      } catch (error) {
        throw new ModelStorageError('Cannot write model connections', { cause: error })
      }
    },
    readDefaultImageModel() {
      return readDefault(database)
    },
    writeDefaultImageModel(model) {
      try {
        database.transaction(() => {
          database.prepare('DELETE FROM default_image_model').run()
          if (model)
            database
              .prepare(
                `INSERT INTO default_image_model
            (singleton, connection_id, model_id) VALUES (1, ?, ?)`
              )
              .run(model.connectionId, model.modelId)
        })()
      } catch (error) {
        throw new ModelStorageError('Cannot write default image model', { cause: error })
      }
    }
  }
}

function toModel(row: ModelRow, results: readonly CapabilityRow[]): ModelOptionDto {
  const capabilities = Object.fromEntries(
    CAPABILITIES.map((capability) => {
      const row = results.find((result) => result.capability === capability)
      return [
        capability,
        row
          ? {
              state: row.state,
              source: row.source,
              ...(row.tested_at ? { testedAt: row.tested_at } : {}),
              ...(row.failure_code && row.failure_message
                ? {
                    failure: {
                      code: row.failure_code as ModelFailureCode,
                      message: row.failure_message
                    }
                  }
                : {})
            }
          : { state: 'untested', source: 'legacy' }
      ]
    })
  ) as Record<ModelCapability, ModelCapabilityResultDto>
  return {
    id: row.model_id,
    name: row.name,
    enabled: row.enabled === 1,
    testState: toTestState(row.test_state),
    kind: row.model_kind === 'image' ? 'image' : 'chat',
    imageInputEnabled: row.image_input_enabled === 1,
    imageGenerationEnabled: row.image_generation_enabled === 1,
    imageGenerationApi: row.image_generation_api === 'token-plan' ? 'token-plan' : 'openai-images',
    capabilities
  }
}

function readDefault(database: Database.Database): ModelRef | null {
  const row = database
    .prepare('SELECT connection_id, model_id FROM default_image_model WHERE singleton = 1')
    .get() as { connection_id: string; model_id: string } | undefined
  return row ? { connectionId: row.connection_id, modelId: row.model_id } : null
}

function toProtocol(value: string): ModelProtocol {
  return value === 'anthropic' ? 'anthropic' : 'openai-compatible'
}

function toTestState(value: string): ModelTestState {
  return value === 'success' || value === 'failed' || value === 'unsupported' || value === 'testing'
    ? value
    : 'untested'
}
