import type { RuntimeMigration } from './types'

export const migrations9To12: readonly RuntimeMigration[] = [
  {
    version: 9,
    name: 'add-conversation-image-assets-and-model-capabilities',
    up(database) {
      database.exec(`
        ALTER TABLE model_connection_models ADD COLUMN image_input_enabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE model_connection_models ADD COLUMN image_generation_enabled INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE default_image_model (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          connection_id TEXT,
          model_id TEXT,
          CHECK ((connection_id IS NULL) = (model_id IS NULL))
        );

        CREATE TABLE session_assets (
          asset_id TEXT PRIMARY KEY,
          session_id TEXT,
          mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
          width INTEGER NOT NULL CHECK (width > 0),
          height INTEGER NOT NULL CHECK (height > 0),
          byte_length INTEGER NOT NULL CHECK (byte_length > 0),
          source TEXT NOT NULL CHECK (source IN ('upload', 'generated')),
          status TEXT NOT NULL CHECK (status IN ('staged', 'bound')),
          created_at TEXT NOT NULL,
          bound_at TEXT,
          CHECK ((status = 'staged' AND session_id IS NULL AND bound_at IS NULL)
              OR (status = 'bound' AND session_id IS NOT NULL AND bound_at IS NOT NULL))
        );
        CREATE INDEX session_assets_session_idx ON session_assets(session_id, created_at);
        CREATE INDEX session_assets_staged_idx ON session_assets(created_at) WHERE status = 'staged';
      `)
    }
  },
  {
    version: 10,
    name: 'add-model-image-generation-api',
    up(database) {
      database.exec(`
        ALTER TABLE model_connection_models
          ADD COLUMN image_generation_api TEXT NOT NULL DEFAULT 'openai-images';
      `)
    }
  },
  {
    version: 11,
    name: 'classify-chat-and-image-models',
    up(database) {
      database.exec(`
        ALTER TABLE model_connection_models
          ADD COLUMN model_kind TEXT NOT NULL DEFAULT 'chat';
        UPDATE model_connection_models
        SET model_kind = 'image'
        WHERE image_generation_enabled = 1
           OR EXISTS (
             SELECT 1 FROM default_image_model AS chosen
             WHERE chosen.connection_id = model_connection_models.connection_id
               AND chosen.model_id = model_connection_models.model_id
           );
      `)
    }
  },
  {
    version: 12,
    name: 'record-model-capability-results',
    up(database) {
      database.exec(`
        CREATE TABLE model_capability_results (
          connection_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          capability TEXT NOT NULL CHECK (capability IN ('text', 'reasoning', 'vision', 'image_generation')),
          state TEXT NOT NULL CHECK (state IN ('untested', 'testing', 'success', 'unsupported', 'failed', 'inconclusive')),
          source TEXT NOT NULL CHECK (source IN ('catalog', 'probe', 'legacy')),
          tested_at TEXT,
          failure_code TEXT,
          failure_message TEXT,
          PRIMARY KEY (connection_id, model_id, capability),
          FOREIGN KEY (connection_id, model_id)
            REFERENCES model_connection_models(connection_id, model_id) ON DELETE CASCADE
        );
        INSERT INTO model_capability_results
          (connection_id, model_id, capability, state, source)
        SELECT models.connection_id, models.model_id, capabilities.capability, 'untested', 'legacy'
        FROM model_connection_models AS models
        CROSS JOIN (
          SELECT 'text' AS capability UNION ALL
          SELECT 'reasoning' UNION ALL
          SELECT 'vision' UNION ALL
          SELECT 'image_generation'
        ) AS capabilities;
      `)
    }
  }
]
