import type Database from 'better-sqlite3'
import type { SessionInputFileBinding, SessionInputFileRecord } from '@action-driver/agent-runtime/ports'

export function inputFileFromRow(row: SessionInputFileRow): SessionInputFileRecord {
  return {
    fileId: row.file_id,
    status: row.status,
    sessionId: row.session_id,
    taskId: row.task_id,
    name: row.name,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    relativePath: row.relative_path,
    checksum: row.checksum,
    createdAt: row.created_at,
    boundAt: row.bound_at
  }
}

export function createInputFileStore(database: Database.Database) {
  return {
    inputFiles: {
      save: async (file: SessionInputFileRecord): Promise<void> => {
        database
          .prepare(
            `INSERT INTO session_input_files
            (file_id, status, session_id, task_id, name, mime_type, byte_length, relative_path,
             checksum, created_at, bound_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(file_id) DO UPDATE SET status = excluded.status,
            session_id = excluded.session_id, task_id = excluded.task_id, name = excluded.name,
            mime_type = excluded.mime_type, byte_length = excluded.byte_length,
            relative_path = excluded.relative_path, checksum = excluded.checksum,
            bound_at = excluded.bound_at`
          )
          .run(
            file.fileId,
            file.status,
            file.sessionId,
            file.taskId,
            file.name,
            file.mimeType,
            file.byteLength,
            file.relativePath,
            file.checksum,
            file.createdAt,
            file.boundAt
          )
      },
      get: async (fileId: string): Promise<SessionInputFileRecord | null> => {
        const row = database
          .prepare('SELECT * FROM session_input_files WHERE file_id = ?')
          .get(fileId) as SessionInputFileRow | undefined
        return row ? inputFileFromRow(row) : null
      },
      listBySession: async (sessionId: string): Promise<SessionInputFileRecord[]> =>
        (
          database
            .prepare(
              `SELECT * FROM session_input_files
             WHERE session_id = ? ORDER BY created_at, file_id`
            )
            .all(sessionId) as SessionInputFileRow[]
        ).map(inputFileFromRow),
      listByTask: async (taskId: string): Promise<SessionInputFileRecord[]> =>
        (
          database
            .prepare(
              'SELECT * FROM session_input_files WHERE task_id = ? ORDER BY created_at, file_id'
            )
            .all(taskId) as SessionInputFileRow[]
        ).map(inputFileFromRow),
      bind: async (
        fileId: string,
        binding: SessionInputFileBinding
      ): Promise<SessionInputFileRecord> => {
        const result = database
          .prepare(
            `UPDATE session_input_files
           SET status = 'bound', session_id = ?, task_id = ?, relative_path = ?, bound_at = ?
           WHERE file_id = ? AND status = 'staged'`
          )
          .run(binding.sessionId, binding.taskId, binding.relativePath, binding.boundAt, fileId)
        const row = database
          .prepare('SELECT * FROM session_input_files WHERE file_id = ?')
          .get(fileId) as SessionInputFileRow | undefined
        if (result.changes === 0 || !row) throw new Error('INPUT_FILE_NOT_STAGED')
        return inputFileFromRow(row)
      }
    }
  }
}

export type SessionInputFileRow = {
  file_id: string
  status: SessionInputFileRecord['status']
  session_id: string | null
  task_id: string | null
  name: string
  mime_type: string
  byte_length: number
  relative_path: string | null
  checksum: string
  created_at: string
  bound_at: string | null
}
