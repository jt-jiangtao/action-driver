import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_RUNTIME_MIGRATIONS,
  openRuntimeDatabase,
  type RuntimeMigration
} from '../src/index'

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
        'messages',
        'runtime_events',
        'schema_migrations',
        'skill_invocations',
        'steps',
        'tasks'
      ])
    )
    expect(database.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: 1 }
    ])

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
    ).toEqual([{ version: 1, count: 1 }])

    database.close()
  })

  it('rolls back a failed migration and preserves the last applied version', () => {
    const path = databasePath()
    const failingMigration: RuntimeMigration = {
      version: 2,
      name: 'fail-after-writing',
      up(database) {
        database.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)')
        throw new Error('injected migration failure')
      }
    }

    expect(() =>
      openRuntimeDatabase(path, [...DEFAULT_RUNTIME_MIGRATIONS, failingMigration])
    ).toThrow('Migration 2 (fail-after-writing) failed: injected migration failure')

    const database = new Database(path)
    expect(database.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: 1 }
    ])
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
        .get()
    ).toBeUndefined()
    database.close()
  })
})
