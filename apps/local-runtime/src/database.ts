import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { requiresElectronNativeBinding, resolveElectronNativeBinding } from './native-binding'

export type RuntimeMigration = {
  version: number
  name: string
  up(database: Database.Database): void
}

export const DEFAULT_RUNTIME_MIGRATIONS: readonly RuntimeMigration[] = [
  {
    version: 1,
    name: 'create-runtime-business-schema',
    up(database) {
      database.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL UNIQUE,
          goal TEXT NOT NULL,
          status TEXT NOT NULL,
          last_checkpoint_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX messages_task_created_idx ON messages(task_id, created_at, id);

        CREATE TABLE steps (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          step_key TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          status TEXT NOT NULL,
          checkpoint_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(task_id, step_key, checkpoint_id)
        );

        CREATE TABLE skill_invocations (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          requested_skill_id TEXT NOT NULL,
          resolved_provider_id TEXT,
          provider_version TEXT,
          contract_version INTEGER NOT NULL,
          status TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT,
          error_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX skill_invocations_task_idx ON skill_invocations(task_id, created_at, id);

        CREATE TABLE runtime_events (
          cursor INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL,
          checkpoint_id TEXT NOT NULL,
          event_key TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          UNIQUE(thread_id, checkpoint_id, event_key)
        );

        CREATE INDEX runtime_events_task_cursor_idx ON runtime_events(task_id, cursor);
      `)
    }
  },
  {
    version: 2,
    name: 'create-model-connection-schema',
    up(database) {
      database.exec(`
        CREATE TABLE model_connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          protocol TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_key_cipher TEXT NOT NULL,
          api_key_hint TEXT NOT NULL,
          expanded INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE model_connection_models (
          connection_id TEXT NOT NULL REFERENCES model_connections(id) ON DELETE CASCADE,
          model_id TEXT NOT NULL,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          test_state TEXT NOT NULL,
          position INTEGER NOT NULL,
          PRIMARY KEY (connection_id, model_id)
        );
      `)
    }
  },
  {
    version: 3,
    name: 'add-task-model-and-model-calls',
    up(database) {
      database.exec(`
        ALTER TABLE tasks ADD COLUMN connection_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE tasks ADD COLUMN model_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE tasks ADD COLUMN error_json TEXT;

        CREATE TABLE model_calls (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          correlation_id TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          status TEXT NOT NULL,
          request_json TEXT NOT NULL,
          response_json TEXT,
          error_json TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT
        );

        CREATE INDEX model_calls_task_started_idx ON model_calls(task_id, started_at, id);
      `)
    }
  },
  {
    version: 4,
    name: 'add-recoverable-stream-requests',
    up(database) {
      database.exec(`
        CREATE TABLE stream_requests (
          request_id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          response_id TEXT NOT NULL UNIQUE,
          stream_id TEXT NOT NULL UNIQUE,
          message_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          last_sequence INTEGER NOT NULL DEFAULT -1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX stream_requests_session_created_idx
          ON stream_requests(session_id, created_at, request_id);

        ALTER TABLE runtime_events ADD COLUMN event_id TEXT;
        ALTER TABLE runtime_events ADD COLUMN request_id TEXT;
        ALTER TABLE runtime_events ADD COLUMN response_id TEXT;
        ALTER TABLE runtime_events ADD COLUMN stream_id TEXT;
        ALTER TABLE runtime_events ADD COLUMN message_id TEXT;
        ALTER TABLE runtime_events ADD COLUMN sequence INTEGER;

        CREATE UNIQUE INDEX runtime_events_event_id_unique
          ON runtime_events(event_id) WHERE event_id IS NOT NULL;
        CREATE INDEX runtime_events_request_cursor_idx
          ON runtime_events(request_id, cursor) WHERE request_id IS NOT NULL;
      `)
    }
  },
  {
    version: 5,
    name: 'add-shared-task-session-identity',
    up(database) {
      database.exec(`
        ALTER TABLE tasks ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
        UPDATE tasks SET session_id = thread_id WHERE session_id = '';
        CREATE INDEX tasks_session_updated_idx
          ON tasks(session_id, updated_at DESC, id DESC);
      `)
    }
  },
  {
    version: 6,
    name: 'add-tool-invocations',
    up(database) {
      database.exec(`
        CREATE TABLE tool_invocations (
          id TEXT PRIMARY KEY,
          provider_call_id TEXT NOT NULL,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          tool_id TEXT NOT NULL,
          tool_version INTEGER NOT NULL,
          arguments_hash TEXT NOT NULL,
          decision TEXT NOT NULL,
          status TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT,
          error_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX tool_invocations_task_idx
          ON tool_invocations(task_id, created_at, id);
      `)
    }
  },
  {
    version: 7,
    name: 'make-request-event-sequences-contiguous',
    up(database) {
      const orphan = database
        .prepare(
          `SELECT e.request_id FROM runtime_events e
           LEFT JOIN stream_requests r ON r.request_id = e.request_id
           WHERE e.request_id IS NOT NULL AND r.request_id IS NULL LIMIT 1`
        )
        .get() as { request_id: string } | undefined
      if (orphan) throw new Error(`Event has no stream request: ${orphan.request_id}`)

      database.exec(`
        WITH ordered AS (
          SELECT cursor,
                 ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY cursor) - 1 AS next_sequence
          FROM runtime_events WHERE request_id IS NOT NULL
        )
        UPDATE runtime_events
        SET sequence = (SELECT next_sequence FROM ordered WHERE ordered.cursor = runtime_events.cursor)
        WHERE request_id IS NOT NULL;

        UPDATE stream_requests
        SET last_sequence = COALESCE(
          (SELECT MAX(sequence) FROM runtime_events
           WHERE runtime_events.request_id = stream_requests.request_id), -1
        );

        CREATE UNIQUE INDEX runtime_events_request_sequence_unique
          ON runtime_events(request_id, sequence) WHERE request_id IS NOT NULL;

        CREATE TRIGGER runtime_events_request_sequence_insert
        BEFORE INSERT ON runtime_events
        WHEN NEW.request_id IS NOT NULL AND (NEW.sequence IS NULL OR NEW.sequence < 0)
        BEGIN
          SELECT RAISE(ABORT, 'request event requires nonnegative sequence');
        END;

        CREATE TRIGGER runtime_events_request_sequence_update
        BEFORE UPDATE OF request_id, sequence ON runtime_events
        WHEN NEW.request_id IS NOT NULL AND (NEW.sequence IS NULL OR NEW.sequence < 0)
        BEGIN
          SELECT RAISE(ABORT, 'request event requires nonnegative sequence');
        END;
      `)
    }
  },
  {
    version: 8,
    name: 'add-runtime-process-ownership',
    up(database) {
      database.exec(`
        CREATE TABLE runtime_process_owner (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          pid INTEGER NOT NULL,
          token TEXT NOT NULL,
          acquired_at TEXT NOT NULL
        );
      `)
    }
  },
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
  },
  {
    version: 13,
    name: 'add-session-input-files',
    up(database) {
      database.exec(`
        CREATE TABLE session_input_files (
          file_id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('staged', 'bound')),
          session_id TEXT,
          task_id TEXT,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          byte_length INTEGER NOT NULL,
          relative_path TEXT,
          checksum TEXT NOT NULL,
          created_at TEXT NOT NULL,
          bound_at TEXT
        );

        CREATE INDEX session_input_files_session_created_idx
          ON session_input_files(session_id, created_at, file_id);
        CREATE INDEX session_input_files_task_idx ON session_input_files(task_id);
      `)
    }
  },
  {
    version: 14,
    name: 'add-task-output-files',
    up(database) {
      database.exec(`
        CREATE TABLE task_output_files (
          file_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          byte_length INTEGER NOT NULL,
          relative_path TEXT NOT NULL,
          checksum TEXT NOT NULL,
          snapshot_path TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX task_output_files_task_created_idx
          ON task_output_files(task_id, created_at, file_id);
        CREATE INDEX task_output_files_session_created_idx
          ON task_output_files(session_id, created_at, file_id);
      `)
    }
  },
  {
    version: 15,
    name: 'add-computer-app-approvals',
    up(database) {
      database.exec(`CREATE TABLE computer_app_approvals (
        bundle_id TEXT PRIMARY KEY,
        approved_at TEXT NOT NULL
      )`)
    }
  },
  {
    version: 16,
    name: 'detach-auxiliary-state-from-session-history',
    up(database) {
      // Session history moved to the append-only rollout log. The auxiliary tables keep their
      // rows but stop referencing the dropped session tables, so the state database stays valid.
      database.exec(`
        CREATE TABLE steps_v16 (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          step_key TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          status TEXT NOT NULL,
          checkpoint_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(task_id, step_key, checkpoint_id)
        );
        INSERT INTO steps_v16
          SELECT id, task_id, step_key, title, detail, status, checkpoint_id, created_at, updated_at
          FROM steps;
        DROP TABLE steps;
        ALTER TABLE steps_v16 RENAME TO steps;

        CREATE TABLE skill_invocations_v16 (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          requested_skill_id TEXT NOT NULL,
          resolved_provider_id TEXT,
          provider_version TEXT,
          contract_version INTEGER NOT NULL,
          status TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT,
          error_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO skill_invocations_v16
          SELECT id, task_id, requested_skill_id, resolved_provider_id, provider_version,
                 contract_version, status, input_json, output_json, error_json, created_at, updated_at
          FROM skill_invocations;
        DROP TABLE skill_invocations;
        ALTER TABLE skill_invocations_v16 RENAME TO skill_invocations;
        CREATE INDEX skill_invocations_task_idx ON skill_invocations(task_id, created_at, id);

        CREATE TABLE runtime_events_v16 (
          cursor INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          checkpoint_id TEXT NOT NULL,
          event_key TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          event_id TEXT,
          request_id TEXT,
          response_id TEXT,
          stream_id TEXT,
          message_id TEXT,
          sequence INTEGER,
          UNIQUE(thread_id, checkpoint_id, event_key)
        );
        INSERT INTO runtime_events_v16
          SELECT cursor, task_id, thread_id, checkpoint_id, event_key, event_type, payload_json,
                 occurred_at, event_id, request_id, response_id, stream_id, message_id, sequence
          FROM runtime_events;
        DROP TABLE runtime_events;
        ALTER TABLE runtime_events_v16 RENAME TO runtime_events;
        CREATE INDEX runtime_events_task_cursor_idx ON runtime_events(task_id, cursor);
        CREATE UNIQUE INDEX runtime_events_event_id_unique
          ON runtime_events(event_id) WHERE event_id IS NOT NULL;
        CREATE INDEX runtime_events_request_cursor_idx
          ON runtime_events(request_id, cursor) WHERE request_id IS NOT NULL;

        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS tool_invocations;
        DROP TABLE IF EXISTS stream_requests;
        DROP TABLE IF EXISTS model_calls;
        DROP TABLE IF EXISTS tasks;
      `)
    }
  }
]

export function openRuntimeDatabase(
  path: string,
  migrations: readonly RuntimeMigration[] = DEFAULT_RUNTIME_MIGRATIONS
): Database.Database {
  const database = createRuntimeDatabase(path)

  try {
    configureDatabase(database)
    ensureMigrationTable(database)
    backupBeforeMigration(database, path, migrations)
    applyMigrations(database, migrations)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function backupBeforeMigration(
  database: Database.Database,
  path: string,
  migrations: readonly RuntimeMigration[]
): void {
  if (path === ':memory:') return
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null
  }
  if (row.version === null || !migrations.some((migration) => migration.version > row.version!)) {
    return
  }
  const targetVersion = migrations.at(-1)?.version
  if (targetVersion === undefined) return
  const backupPath = `${path}.pre-v${targetVersion}-${randomUUID()}.sqlite`
  database.prepare('VACUUM INTO ?').run(backupPath)
}

export function createRuntimeDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  if (!requiresElectronNativeBinding()) return new Database(path)
  return new Database(path, { nativeBinding: resolveElectronNativeBinding() })
}

function configureDatabase(database: Database.Database): void {
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  database.pragma('synchronous = NORMAL')
}

function ensureMigrationTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

function applyMigrations(
  database: Database.Database,
  migrations: readonly RuntimeMigration[]
): void {
  validateMigrations(migrations)
  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version)
  )

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue

    const apply = database.transaction(() => {
      migration.up(database)
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString())
    })

    try {
      apply.immediate()
    } catch (error) {
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }
}

function validateMigrations(migrations: readonly RuntimeMigration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Runtime migrations must be contiguous and forward-only; expected version ${expectedVersion}, received ${migration.version}`
      )
    }
  })
}
