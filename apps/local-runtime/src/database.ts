import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { DEFAULT_RUNTIME_MIGRATIONS, type RuntimeMigration } from './database/migrations'
import { requiresElectronNativeBinding, resolveElectronNativeBinding } from './native-binding'

export { DEFAULT_RUNTIME_MIGRATIONS } from './database/migrations'
export type { RuntimeMigration } from './database/migrations'

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
