import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_RUNTIME_MIGRATIONS,
  openRuntimeDatabase,
  type RuntimeMigration
} from '../../src/index'

const temporaryDirectories: string[] = []

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-runtime-'))
  temporaryDirectories.push(directory)
  return join(directory, 'data', 'actiondriver.db')
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('runtime SQLite database', () => {
  it('creates the business schema with production pragmas before becoming ready', () => {
    const path = databasePath()
    const database = openRuntimeDatabase(path)

    expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5_000)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining([
        'model_connection_models',
        'model_capability_results',
        'model_connections',
        'default_image_model',
        'session_assets',
        'session_input_files',
        'task_output_files',
        'runtime_process_owner',
        'schema_migrations',
        'skill_invocations',
        'steps'
      ])
    )
    // Session history now lives in the rollout log, so its tables must not come back.
    expect(tables).not.toEqual(
      expect.arrayContaining([
        'messages',
        'model_calls',
        'runtime_events',
        'stream_requests',
        'tasks',
        'tool_invocations'
      ])
    )
    expect(database.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }
    ])

    expect(
      database
        .prepare("PRAGMA table_info('model_connection_models')")
        .all()
        .map((row) => (row as { name: string }).name)
    ).toContain('image_generation_api')

    database.close()
  })

  it('is idempotent when the same database starts again', () => {
    const path = databasePath()
    openRuntimeDatabase(path).close()
    const database = openRuntimeDatabase(path)

    expect(
      database
        .prepare('SELECT version, COUNT(*) AS count FROM schema_migrations GROUP BY version')
        .all()
    ).toEqual([
      { version: 1, count: 1 },
      { version: 2, count: 1 },
      { version: 3, count: 1 },
      { version: 4, count: 1 },
      { version: 5, count: 1 },
      { version: 6, count: 1 },
      { version: 7, count: 1 },
      { version: 8, count: 1 },
      { version: 9, count: 1 },
      { version: 10, count: 1 },
      { version: 11, count: 1 },
      { version: 12, count: 1 },
      { version: 13, count: 1 },
      { version: 14, count: 1 },
      { version: 15, count: 1 },
      { version: 16, count: 1 }
    ])

    database.close()
  })

  it('rolls back a failed migration and preserves the last applied version', () => {
    const path = databasePath()
    const failingMigration: RuntimeMigration = {
      version: 17,
      name: 'fail-after-writing',
      up(database) {
        database.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)')
        throw new Error('injected migration failure')
      }
    }

    expect(() =>
      openRuntimeDatabase(path, [...DEFAULT_RUNTIME_MIGRATIONS, failingMigration])
    ).toThrow('Migration 17 (fail-after-writing) failed: injected migration failure')

    const database = new Database(path)
    expect(database.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 }
    ])
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
        .get()
    ).toBeUndefined()
    database.close()
  })

  it('leaves a correct session_input_files table untouched', () => {
    const path = databasePath()
    const database = openRuntimeDatabase(path)
    expect(database.prepare('PRAGMA foreign_key_list(session_input_files)').all()).toEqual([])
    expect(
      (
        database.prepare('PRAGMA table_info(session_input_files)').all() as Array<{ name: string }>
      ).map((column) => column.name)
    ).toEqual([
      'file_id',
      'status',
      'session_id',
      'task_id',
      'name',
      'mime_type',
      'byte_length',
      'relative_path',
      'checksum',
      'created_at',
      'bound_at'
    ])
    database.close()
  })
})
