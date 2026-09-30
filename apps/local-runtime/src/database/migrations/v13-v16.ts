import type { RuntimeMigration } from './types'

export const migrations13To16: readonly RuntimeMigration[] = [
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
