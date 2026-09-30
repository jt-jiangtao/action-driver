import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

type Owner = { pid: number; token: string }

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Claims the single Runtime writer for this database before any startup recovery. */
export function claimRuntimeOwnership(
  database: Database.Database,
  options: { pid?: number; isAlive?: (pid: number) => boolean } = {}
): { release(): void } {
  const pid = options.pid ?? process.pid
  const isAlive = options.isAlive ?? processIsAlive
  const token = randomUUID()
  database.transaction(() => {
    const owner = database.prepare(
      'SELECT pid, token FROM runtime_process_owner WHERE singleton = 1'
    ).get() as Owner | undefined
    if (owner && isAlive(owner.pid)) {
      throw new Error(`RUNTIME_ALREADY_RUNNING: database is owned by process ${owner.pid}`)
    }
    database.prepare('DELETE FROM runtime_process_owner WHERE singleton = 1').run()
    database.prepare(
      'INSERT INTO runtime_process_owner (singleton, pid, token, acquired_at) VALUES (1, ?, ?, ?)'
    ).run(pid, token, new Date().toISOString())
  }).immediate()

  let released = false
  return {
    release() {
      if (released) return
      released = true
      database.prepare(
        'DELETE FROM runtime_process_owner WHERE singleton = 1 AND token = ?'
      ).run(token)
    }
  }
}
