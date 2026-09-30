import type { RuntimeMigration } from './types'

export const migration17: RuntimeMigration = {
  version: 17,
  name: 'record-model-image-endpoint-verification',
  up(database) {
    database.exec(`
      ALTER TABLE model_connection_models
        ADD COLUMN image_endpoint_verification TEXT;
    `)
  }
}
