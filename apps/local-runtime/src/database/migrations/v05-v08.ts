import type { RuntimeMigration } from './types'

export const migrations5To8: readonly RuntimeMigration[] = [
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
  }
]
