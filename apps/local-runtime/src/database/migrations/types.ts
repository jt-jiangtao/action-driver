import type Database from 'better-sqlite3'

export type RuntimeMigration = {
  version: number
  name: string
  up(database: Database.Database): void
}
