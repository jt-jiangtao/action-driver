import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
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
    applyMigrations(database, migrations)
    return database
  } catch (error) {
    database.close()
    throw error
  }
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
