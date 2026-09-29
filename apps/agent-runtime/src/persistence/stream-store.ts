import type Database from 'better-sqlite3'
import type { PersistedStreamRequest, RuntimeEventRecord } from '../ports'
import { assertPersistablePayload } from '../persistence-guard'

export function saveStreamRequest(
  database: Database.Database,
  request: PersistedStreamRequest
): void {
  database
    .prepare(
      `INSERT INTO stream_requests
        (request_id, idempotency_key, session_id, task_id, response_id, stream_id, message_id,
         status, last_sequence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      request.requestId,
      request.idempotencyKey,
      request.sessionId,
      request.taskId,
      request.responseId,
      request.streamId,
      request.messageId,
      request.status,
      request.lastSequence,
      request.createdAt,
      request.updatedAt
    )
}

/**
 * Appends one runtime event, advancing the owning request's sequence inside the caller's
 * transaction. A rejected payload leaves both the event and the sequence untouched.
 */
export function appendEvent(
  database: Database.Database,
  event: Omit<RuntimeEventRecord, 'cursor'>
): RuntimeEventRecord {
  assertPersistablePayload(event.payload, 'runtimeEvent.payload')
  const payload =
    event.type.startsWith('tool.') &&
    typeof event.sequence === 'number' &&
    event.payload !== null &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload) &&
    !('sequence' in event.payload) &&
    !('callSequence' in event.payload)
      ? { ...event.payload, callSequence: event.sequence }
      : event.payload
  let sequence = event.sequence ?? null
  if (event.requestId) {
    const row = database
      .prepare(
        `UPDATE stream_requests SET last_sequence = last_sequence + 1, updated_at = ?
         WHERE request_id = ? RETURNING last_sequence`
      )
      .get(event.occurredAt, event.requestId) as { last_sequence: number } | undefined
    if (!row) throw new Error(`Unknown stream request: ${event.requestId}`)
    sequence = row.last_sequence
  }
  const result = database
    .prepare(
      `INSERT INTO runtime_events
        (task_id, thread_id, checkpoint_id, event_key, event_type, payload_json, occurred_at,
         event_id, request_id, response_id, stream_id, message_id, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.taskId,
      event.threadId,
      event.checkpointId,
      event.eventKey,
      event.type,
      JSON.stringify(payload),
      event.occurredAt,
      event.eventId ?? null,
      event.requestId ?? null,
      event.responseId ?? null,
      event.streamId ?? null,
      event.messageId ?? null,
      sequence
    )
  const persistedEvent = { ...event }
  delete persistedEvent.sequence
  return {
    ...persistedEvent,
    payload,
    ...(sequence === null ? {} : { sequence }),
    cursor: Number(result.lastInsertRowid)
  }
}

export function eventFromRow(row: EventRow): RuntimeEventRecord {
  return {
    cursor: row.cursor,
    taskId: row.task_id,
    threadId: row.thread_id,
    checkpointId: row.checkpoint_id,
    eventKey: row.event_key,
    type: row.event_type,
    payload: JSON.parse(row.payload_json) as unknown,
    occurredAt: row.occurred_at,
    ...(row.event_id === null ? {} : { eventId: row.event_id }),
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
    ...(row.response_id === null ? {} : { responseId: row.response_id }),
    ...(row.stream_id === null ? {} : { streamId: row.stream_id }),
    ...(row.message_id === null ? {} : { messageId: row.message_id }),
    ...(row.sequence === null ? {} : { sequence: row.sequence })
  }
}

export function streamRequestFromRow(row: StreamRequestRow): PersistedStreamRequest {
  return {
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    sessionId: row.session_id,
    taskId: row.task_id,
    responseId: row.response_id,
    streamId: row.stream_id,
    messageId: row.message_id,
    status: row.status,
    lastSequence: row.last_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Stream requests and runtime events share the caller's SQLite connection: every append runs
 * inside the aggregate transaction that owns it, so cursor and sequence allocation stay atomic.
 */
export function createStreamStore(database: Database.Database) {
  return {
    streamRequests: {
      getByRequestId: async (requestId: string): Promise<PersistedStreamRequest | null> => {
        const row = database
          .prepare('SELECT * FROM stream_requests WHERE request_id = ?')
          .get(requestId) as StreamRequestRow | undefined
        return row ? streamRequestFromRow(row) : null
      },
      getByTaskId: async (taskId: string): Promise<PersistedStreamRequest | null> => {
        const row = database
          .prepare('SELECT * FROM stream_requests WHERE task_id = ?')
          .get(taskId) as StreamRequestRow | undefined
        return row ? streamRequestFromRow(row) : null
      },
      getByIdempotencyKey: async (
        idempotencyKey: string
      ): Promise<PersistedStreamRequest | null> => {
        const row = database
          .prepare('SELECT * FROM stream_requests WHERE idempotency_key = ?')
          .get(idempotencyKey) as StreamRequestRow | undefined
        return row ? streamRequestFromRow(row) : null
      }
    },
    events: {
      append: async (event: Omit<RuntimeEventRecord, 'cursor'>): Promise<RuntimeEventRecord> =>
        database.transaction(() => appendEvent(database, event)).immediate(),
      listAfter: async (cursor: number): Promise<RuntimeEventRecord[]> =>
        (
          database
            .prepare('SELECT * FROM runtime_events WHERE cursor > ? ORDER BY cursor')
            .all(cursor) as EventRow[]
        ).map(eventFromRow),
      listForRequestAfter: async (
        requestId: string,
        cursor: number,
        limit: number
      ): Promise<RuntimeEventRecord[]> =>
        (
          database
            .prepare(
              `SELECT * FROM runtime_events
             WHERE request_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`
            )
            .all(requestId, cursor, limit) as EventRow[]
        ).map(eventFromRow)
    }
  }
}

export type EventRow = {
  cursor: number
  task_id: string
  thread_id: string
  checkpoint_id: string
  event_key: string
  event_type: string
  payload_json: string
  occurred_at: string
  event_id: string | null
  request_id: string | null
  response_id: string | null
  stream_id: string | null
  message_id: string | null
  sequence: number | null
}

export type StreamRequestRow = {
  request_id: string
  idempotency_key: string
  session_id: string
  task_id: string
  response_id: string
  stream_id: string
  message_id: string
  status: PersistedStreamRequest['status']
  last_sequence: number
  created_at: string
  updated_at: string
}
