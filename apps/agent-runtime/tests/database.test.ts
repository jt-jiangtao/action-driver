import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInteractionLogRecorder } from '@actiondriver/observability'
import {
  ConnectionModelGateway,
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
  it('keeps historical model calls while new model completions do not append rows', async () => {
    const path = databasePath()
    const old = openRuntimeDatabase(path)
    old
      .prepare(
        `INSERT INTO tasks
      (id, thread_id, session_id, goal, status, created_at, updated_at, connection_id, model_id)
      VALUES ('historic-task', 'historic-task', 'historic-session', 'old', 'completed',
        '2026-01-01', '2026-01-01', 'connection', 'model')`
      )
      .run()
    old
      .prepare(
        `INSERT INTO model_calls
      (id, task_id, request_id, correlation_id, connection_id, model_id, status,
       request_json, response_json, started_at)
      VALUES ('historic-call', 'historic-task', 'historic-request', 'historic-correlation',
        'connection', 'model', 'completed', '{"prompt":"historic input"}',
        '{"text":"historic output"}', '2026-01-01')`
      )
      .run()
    old.close()

    const upgraded = openRuntimeDatabase(path)
    const gateway = new ConnectionModelGateway({
      service: {
        complete: async () => ({
          ok: true as const,
          value: {
            content: 'new result',
            providerProtocol: 'openai-compatible' as const,
            requestBody: { prompt: 'new input' },
            responseBody: { text: 'new result' },
            status: 200
          }
        }),
        async *stream() {
          yield* []
          throw new Error('unused')
        }
      },
      interactions: createInteractionLogRecorder({
        ids: { eventId: () => 'new-event', correlationId: () => 'new-correlation' },
        clock: () => 1
      }),
      correlationId: () => 'new-correlation',
      now: () => '2026-09-24T00:00:00Z'
    })
    await expect(
      gateway.complete({
        taskId: 'new-task',
        requestId: 'new-request',
        model: { connectionId: 'connection', modelId: 'model' },
        messages: [{ role: 'user', content: 'new input' }],
        skills: [],
        parameters: { temperature: 0 }
      })
    ).resolves.toEqual({ kind: 'finish', content: 'new result' })
    expect(
      upgraded.prepare('SELECT id, request_json, response_json FROM model_calls').all()
    ).toEqual([
      {
        id: 'historic-call',
        request_json: '{"prompt":"historic input"}',
        response_json: '{"text":"historic output"}'
      }
    ])
    upgraded.close()
  })

  it('backfills interleaved legacy requests to contiguous per-request sequences', () => {
    const path = databasePath()
    const legacy = openRuntimeDatabase(path, DEFAULT_RUNTIME_MIGRATIONS.slice(0, 4))
    for (const id of ['a', 'b']) {
      legacy
        .prepare(
          `INSERT INTO tasks
           (id, thread_id, goal, status, created_at, updated_at, connection_id, model_id)
           VALUES (?, ?, 'goal', 'running', '2026-01-01', '2026-01-01', 'connection', 'model')`
        )
        .run(id, id)
      legacy
        .prepare(
          `INSERT INTO stream_requests
           (request_id, idempotency_key, session_id, task_id, response_id, stream_id,
            message_id, status, last_sequence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 1, '2026-01-01', '2026-01-01')`
        )
        .run(id, `key-${id}`, id, id, `response-${id}`, `stream-${id}`, `message-${id}`)
    }
    for (const [requestId, eventKey, oldSequence] of [
      ['a', 'accepted', null],
      ['b', 'accepted', null],
      ['a', 'start', 0],
      ['b', 'start', 0]
    ] as const) {
      legacy
        .prepare(
          `INSERT INTO runtime_events
           (task_id, thread_id, checkpoint_id, event_key, event_type, payload_json,
            occurred_at, event_id, request_id, sequence)
           VALUES (?, ?, ?, ?, ?, '{}', '2026-01-01', ?, ?, ?)`
        )
        .run(
          requestId,
          requestId,
          `response-${requestId}`,
          eventKey,
          eventKey,
          `${requestId}-${eventKey}`,
          requestId,
          oldSequence
        )
    }
    legacy.close()

    const upgraded = openRuntimeDatabase(path)
    expect(
      upgraded
        .prepare('SELECT request_id, cursor, sequence FROM runtime_events ORDER BY cursor')
        .all()
    ).toEqual([
      { request_id: 'a', cursor: 1, sequence: 0 },
      { request_id: 'b', cursor: 2, sequence: 0 },
      { request_id: 'a', cursor: 3, sequence: 1 },
      { request_id: 'b', cursor: 4, sequence: 1 }
    ])
    expect(
      upgraded
        .prepare('SELECT request_id, last_sequence FROM stream_requests ORDER BY request_id')
        .all()
    ).toEqual([
      { request_id: 'a', last_sequence: 1 },
      { request_id: 'b', last_sequence: 1 }
    ])
    expect(() =>
      upgraded
        .prepare(
          `INSERT INTO runtime_events
           (task_id, thread_id, checkpoint_id, event_key, event_type, payload_json,
            occurred_at, event_id, request_id, sequence)
           VALUES ('a', 'a', 'response-a', 'duplicate', 'duplicate', '{}',
            '2026-01-01', 'a-duplicate', 'a', 1)`
        )
        .run()
    ).toThrow()
    expect(() =>
      upgraded
        .prepare(
          `INSERT INTO runtime_events
           (task_id, thread_id, checkpoint_id, event_key, event_type, payload_json,
            occurred_at, event_id, request_id, sequence)
           VALUES ('a', 'a', 'response-a', 'missing-sequence', 'activity.started', '{}',
            '2026-01-01', 'a-missing-sequence', 'a', NULL)`
        )
        .run()
    ).toThrow()
    upgraded.close()
    expect(
      readdirSync(dirname(path)).some((name) => name.startsWith('actiondriver.db.pre-v14-'))
    ).toBe(true)
  })
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
        'model_calls',
        'model_connection_models',
        'model_capability_results',
        'model_connections',
        'default_image_model',
        'session_assets',
        'session_input_files',
        'task_output_files',
        'runtime_events',
        'runtime_process_owner',
        'schema_migrations',
        'skill_invocations',
        'steps',
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
      { version: 14 }
    ])

    expect(
      database
        .prepare("PRAGMA table_info('tasks')")
        .all()
        .map((row) => (row as { name: string }).name)
    ).toContain('session_id')

    expect(
      database
        .prepare("PRAGMA table_info('model_connection_models')")
        .all()
        .map((row) => (row as { name: string }).name)
    ).toContain('image_generation_api')

    expect(
      database
        .prepare("PRAGMA table_info('runtime_events')")
        .all()
        .map((row) => (row as { name: string }).name)
    ).toEqual(
      expect.arrayContaining([
        'event_id',
        'request_id',
        'response_id',
        'stream_id',
        'message_id',
        'sequence'
      ])
    )

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
      { version: 14, count: 1 }
    ])

    database.close()
  })

  it('rolls back a failed migration and preserves the last applied version', () => {
    const path = databasePath()
    const failingMigration: RuntimeMigration = {
      version: 15,
      name: 'fail-after-writing',
      up(database) {
        database.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)')
        throw new Error('injected migration failure')
      }
    }

    expect(() =>
      openRuntimeDatabase(path, [...DEFAULT_RUNTIME_MIGRATIONS, failingMigration])
    ).toThrow('Migration 15 (fail-after-writing) failed: injected migration failure')

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
      { version: 14 }
    ])
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
        .get()
    ).toBeUndefined()
    database.close()
  })
})
