import type { ModelOptionDto, ModelProtocol, ModelTestState } from '@actiondriver/model-connections'
import type { ModelConnectionStore, StoredModelConnection } from './store'
import { ModelStorageError } from './store'
import type Database from 'better-sqlite3'

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
}

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
            `SELECT connection_id, model_id, name, enabled, test_state
             FROM model_connection_models ORDER BY connection_id, position`
          )
          .all() as ModelRow[]

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
            .map(toModel)
        }))
      } catch (error) {
        throw new ModelStorageError('Cannot read model connections', { cause: error })
      }
    },
    write(connections) {
      try {
        const replace = database.transaction((next: readonly StoredModelConnection[]) => {
          database.prepare('DELETE FROM model_connection_models').run()
          database.prepare('DELETE FROM model_connections').run()
          const insertConnection = database.prepare(
            `INSERT INTO model_connections
               (id, name, protocol, base_url, api_key_cipher, api_key_hint, expanded, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          const insertModel = database.prepare(
            `INSERT INTO model_connection_models
               (connection_id, model_id, name, enabled, test_state, position)
             VALUES (?, ?, ?, ?, ?, ?)`
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
                index
              )
            })
          }
        })
        replace(connections)
      } catch (error) {
        throw new ModelStorageError('Cannot write model connections', { cause: error })
      }
    }
  }
}

function toModel(row: ModelRow): ModelOptionDto {
  return {
    id: row.model_id,
    name: row.name,
    enabled: row.enabled === 1,
    testState: toTestState(row.test_state)
  }
}

function toProtocol(value: string): ModelProtocol {
  return value === 'anthropic' ? 'anthropic' : 'openai-compatible'
}

function toTestState(value: string): ModelTestState {
  return value === 'success' || value === 'failed' || value === 'unsupported' || value === 'testing'
    ? value
    : 'untested'
}
