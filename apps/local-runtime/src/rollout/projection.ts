import type Database from 'better-sqlite3'
import type { PersistedStreamRequest } from '@action-driver/agent-runtime/ports'
import { createRuntimeDatabase } from '../database'
import { readRollout } from './log'
import type { RolloutLine } from './model'

export type RolloutProjectionPaths = {
  /** Session/thread metadata: mutable state, rewritten in place. */
  statePath: string
  /** Append-projected turn and item history plus its projection cursor. */
  historyPath: string
}

export type ProjectedThread = {
  sessionId: string
  title: string
  status: string
  model: { connectionId: string; modelId: string }
  goal: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  archived: boolean
  archivedAt: string | null
  rolloutPath: string
}

export type ProjectedItem = {
  turnId: string
  itemId: string
  itemType: string
  rolloutOrdinal: number
  updatedAtOrdinal: number
  item: unknown
}

export type ProjectedTurn = {
  turnId: string
  sessionId: string
  rolloutOrdinal: number
  endOrdinal: number | null
  goal: string
  status: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  error: unknown | null
}

/**
 * Queryable index over the rollout logs. It is a projection, never a second
 * source of truth: it records the byte offset and ordinal it has consumed, can
 * resume from that cursor, and can be dropped and rebuilt from the logs alone.
 */
export class RolloutProjection {
  constructor(
    private readonly state: Database.Database,
    private readonly history: Database.Database
  ) {}

  static open(paths: RolloutProjectionPaths): RolloutProjection {
    const state = createRuntimeDatabase(paths.statePath)
    const history = createRuntimeDatabase(paths.historyPath)
    state.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running',
        model_connection_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        rollout_path TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS threads_updated_idx ON threads(updated_at DESC, session_id DESC);

      CREATE TABLE IF NOT EXISTS stream_requests (
        request_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        response_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        status TEXT NOT NULL,
        last_sequence INTEGER NOT NULL DEFAULT -1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stream_requests_task_idx ON stream_requests(task_id);
      CREATE INDEX IF NOT EXISTS stream_requests_key_idx ON stream_requests(idempotency_key);
    `)
    const threadColumns = state.pragma('table_info(threads)') as Array<{ name: string }>
    if (!threadColumns.some((column) => column.name === 'pinned'))
      state.exec('ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    if (!threadColumns.some((column) => column.name === 'archived_at'))
      state.exec('ALTER TABLE threads ADD COLUMN archived_at TEXT')
    history.exec(`
      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        rollout_ordinal INTEGER NOT NULL,
        end_ordinal INTEGER,
        goal TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        error_json TEXT
      );
      CREATE INDEX IF NOT EXISTS turns_session_page ON turns(session_id, rollout_ordinal);

      CREATE TABLE IF NOT EXISTS turn_items (
        turn_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        rollout_ordinal INTEGER NOT NULL,
        updated_at_ordinal INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        item_json TEXT NOT NULL,
        PRIMARY KEY (turn_id, item_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS turn_items_page ON turn_items(turn_id, rollout_ordinal);

      CREATE TABLE IF NOT EXISTS projection_state (
        session_id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        next_byte_offset INTEGER NOT NULL DEFAULT 0,
        next_ordinal INTEGER NOT NULL DEFAULT 0
      );
    `)
    return new RolloutProjection(state, history)
  }

  close(): void {
    this.state.close()
    this.history.close()
  }

  /** Projects new records. Re-running it is idempotent, and a changed log path rebuilds. */
  project(rollout: { sessionId: string; path: string }): void {
    const previous = this.readProjectionState(rollout.sessionId)
    const rebuild = previous !== null && previous.rolloutPath !== rollout.path
    if (rebuild) this.dropSession(rollout.sessionId)
    const byteOffset = rebuild || previous === null ? 0 : previous.nextByteOffset
    const nextOrdinal = rebuild || previous === null ? 0 : previous.nextOrdinal
    this.setProjectionState(rollout.sessionId, rollout.path, byteOffset, nextOrdinal)

    const { lines, validBytes } = readRollout(rollout.path, byteOffset)
    let cursor = nextOrdinal
    const apply = this.history.transaction(() => {
      for (const line of lines) {
        if (line.seq < cursor) continue
        this.applyLine(rollout.sessionId, rollout.path, line)
        cursor = Math.max(cursor, line.seq + 1)
      }
      this.setProjectionState(rollout.sessionId, rollout.path, validBytes, cursor)
    })
    apply.immediate()
  }

  /** Drops and rebuilds a session from its log alone. */
  rebuild(rollout: { sessionId: string; path: string }): void {
    this.dropSession(rollout.sessionId)
    this.deleteProjectionState(rollout.sessionId)
    this.project(rollout)
  }

  deleteSession(sessionId: string): void {
    this.history.transaction(() => {
      this.dropSession(sessionId)
      this.deleteProjectionState(sessionId)
    }).immediate()
    this.state.prepare('DELETE FROM stream_requests WHERE session_id = ?').run(sessionId)
  }

  getThread(sessionId: string): ProjectedThread | null {
    const row = this.state.prepare('SELECT * FROM threads WHERE session_id = ?').get(sessionId) as
      | ThreadRow
      | undefined
    return row ? threadFromRow(row) : null
  }

  listThreads(limit: number): ProjectedThread[] {
    const rows = this.state
      .prepare('SELECT * FROM threads ORDER BY updated_at DESC, session_id DESC LIMIT ?')
      .all(limit) as ThreadRow[]
    return rows.map(threadFromRow)
  }

  queryThreads(input: {
    archived: boolean
    query?: string
    limit: number
    cursor?: string | null
  }): {
    items: ProjectedThread[]
    nextCursor: string | null
  } {
    const limit = Math.max(1, Math.min(input.limit, 100))
    const term = (input.query ?? '').trim().toLowerCase()
    const cursor = input.cursor ? decodeThreadCursor(input.cursor) : null
    const timeColumn = input.archived ? 'archived_at' : 'updated_at'
    const order = input.archived
      ? 'archived_at DESC, session_id DESC'
      : 'updated_at DESC, session_id DESC'
    const where = ['archived = ?', "LOWER(title) LIKE ? ESCAPE '\\'"]
    const args: Array<string | number> = [
      Number(input.archived),
      `%${term.replace(/[\\%_]/g, '\\$&')}%`
    ]
    if (cursor) {
      where.push(
        input.archived
          ? `(archived_at < ? OR (archived_at = ? AND session_id < ?))`
          : `(${timeColumn} < ? OR (${timeColumn} = ? AND session_id < ?))`
      )
      if (input.archived) args.push(cursor.time, cursor.time, cursor.id)
      else args.push(cursor.time, cursor.time, cursor.id)
    }
    const rows = this.state
      .prepare(`SELECT * FROM threads WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
      .all(...args, limit + 1) as ThreadRow[]
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page.map(threadFromRow),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                pinned: last.pinned,
                time: input.archived ? last.archived_at : last.updated_at,
                id: last.session_id
              })
            ).toString('base64url')
          : null
    }
  }

  saveStreamRequest(request: PersistedStreamRequest): void {
    this.state
      .prepare(
        `INSERT INTO stream_requests
           (request_id, idempotency_key, session_id, task_id, response_id, stream_id, message_id,
            status, last_sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(request_id) DO UPDATE SET
           status = excluded.status,
           last_sequence = MAX(stream_requests.last_sequence, excluded.last_sequence),
           updated_at = excluded.updated_at`
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

  listStreamRequests(): PersistedStreamRequest[] {
    const rows = this.state
      .prepare('SELECT * FROM stream_requests ORDER BY created_at, request_id')
      .all() as StreamRequestRow[]
    return rows.map(streamRequestFromRow)
  }

  listTurns(sessionId: string): ProjectedTurn[] {
    const rows = this.history
      .prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY rollout_ordinal')
      .all(sessionId) as TurnRow[]
    return rows.map(turnFromRow)
  }

  listAllTurns(): ProjectedTurn[] {
    const rows = this.history
      .prepare('SELECT * FROM turns ORDER BY session_id, rollout_ordinal')
      .all() as TurnRow[]
    return rows.map(turnFromRow)
  }

  readTurnItems(turnId: string): ProjectedItem[] {
    const rows = this.history
      .prepare('SELECT * FROM turn_items WHERE turn_id = ? ORDER BY rollout_ordinal')
      .all(turnId) as ItemRow[]
    return rows.map((row) => ({
      turnId: row.turn_id,
      itemId: row.item_id,
      itemType: row.item_type,
      rolloutOrdinal: row.rollout_ordinal,
      updatedAtOrdinal: row.updated_at_ordinal,
      item: JSON.parse(row.item_json) as unknown
    }))
  }

  private applyLine(sessionId: string, rolloutPath: string, line: RolloutLine): void {
    if (line.t === 'session_meta') {
      this.state
        .prepare(
          `INSERT INTO threads
             (session_id, title, status, model_connection_id, model_id, goal, created_at, updated_at, archived, rollout_path)
           VALUES (?, '', 'running', ?, ?, '', ?, ?, 0, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             model_connection_id = excluded.model_connection_id,
             model_id = excluded.model_id,
             rollout_path = excluded.rollout_path`
        )
        .run(sessionId, line.model.connectionId, line.model.modelId, line.ts, line.ts, rolloutPath)
      return
    }
    if (line.t === 'session_state') {
      this.state
        .prepare(
          'UPDATE threads SET pinned = ?, archived = ?, archived_at = ? WHERE session_id = ?'
        )
        .run(Number(line.pinned), Number(line.archived), line.archivedAt, sessionId)
      return
    }
    if (line.t === 'turn_begin') {
      this.history
        .prepare(
          `INSERT INTO turns (turn_id, session_id, rollout_ordinal, goal, status, started_at)
           VALUES (?, ?, ?, ?, 'running', ?)
           ON CONFLICT(turn_id) DO UPDATE SET goal = excluded.goal`
        )
        .run(line.turnId, sessionId, line.seq, line.goal, line.ts)
      this.touchThread(sessionId, line.ts, line.goal)
      return
    }
    if (line.t === 'turn_end') {
      this.history
        .prepare(
          `UPDATE turns
             SET status = ?, completed_at = ?, duration_ms = ?, error_json = ?, end_ordinal = ?
           WHERE turn_id = ?`
        )
        .run(
          line.status,
          line.ts,
          line.durationMs ?? null,
          line.error === undefined ? null : JSON.stringify(line.error),
          line.seq,
          line.turnId
        )
      this.touchThread(sessionId, line.ts)
      return
    }
    if (line.t === 'block') {
      const itemId = line.blockId
      const itemType = line.kind
      this.history
        .prepare(
          `INSERT INTO turn_items (turn_id, session_id, item_id, rollout_ordinal, updated_at_ordinal, item_type, item_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(turn_id, item_id) DO UPDATE SET
             rollout_ordinal = MIN(turn_items.rollout_ordinal, excluded.rollout_ordinal),
             updated_at_ordinal = excluded.updated_at_ordinal,
             item_type = excluded.item_type,
             item_json = excluded.item_json`
        )
        .run(line.turnId, sessionId, itemId, line.seq, line.seq, itemType, JSON.stringify(line))
      return
    }
    if (line.t === 'event') return
    if (line.t === 'activity_text') {
      this.history
        .prepare(
          `INSERT INTO turn_items (turn_id, session_id, item_id, rollout_ordinal, updated_at_ordinal, item_type, item_json)
           VALUES (?, ?, ?, ?, ?, 'activity_text', ?)
           ON CONFLICT(turn_id, item_id) DO UPDATE SET
             rollout_ordinal = MIN(turn_items.rollout_ordinal, excluded.rollout_ordinal),
             updated_at_ordinal = excluded.updated_at_ordinal,
             item_json = excluded.item_json`
        )
        .run(
          line.turnId,
          sessionId,
          `activity_text:${line.textId}`,
          line.seq,
          line.seq,
          JSON.stringify(line)
        )
      return
    }
    if (line.t === 'message') {
      this.history
        .prepare(
          `INSERT INTO turn_items (turn_id, session_id, item_id, rollout_ordinal, updated_at_ordinal, item_type, item_json)
           VALUES (?, ?, ?, ?, ?, 'message', ?)
           ON CONFLICT(turn_id, item_id) DO UPDATE SET
             rollout_ordinal = MIN(turn_items.rollout_ordinal, excluded.rollout_ordinal),
             updated_at_ordinal = excluded.updated_at_ordinal,
             item_json = excluded.item_json`
        )
        .run(
          line.turnId,
          sessionId,
          `message:${line.messageId}`,
          line.seq,
          line.seq,
          JSON.stringify(line)
        )
      return
    }
    const callId = line.callId
    this.history
      .prepare(
        `INSERT INTO turn_items (turn_id, session_id, item_id, rollout_ordinal, updated_at_ordinal, item_type, item_json)
         VALUES (?, ?, ?, ?, ?, 'tool', ?)
         ON CONFLICT(turn_id, item_id) DO UPDATE SET
           rollout_ordinal = MIN(turn_items.rollout_ordinal, excluded.rollout_ordinal),
           updated_at_ordinal = excluded.updated_at_ordinal,
           item_json = excluded.item_json`
      )
      .run(line.turnId, sessionId, `tool:${callId}`, line.seq, line.seq, JSON.stringify(line))
  }

  private touchThread(sessionId: string, at: string, goal?: string): void {
    this.state
      .prepare(
        `UPDATE threads
           SET updated_at = ?,
               title = CASE WHEN title = '' AND ? IS NOT NULL THEN ? ELSE title END,
               goal = CASE WHEN goal = '' AND ? IS NOT NULL THEN ? ELSE goal END
         WHERE session_id = ?`
      )
      .run(at, goal ?? null, goal ?? '', goal ?? null, goal ?? '', sessionId)
  }

  private readProjectionState(
    sessionId: string
  ): { rolloutPath: string; nextByteOffset: number; nextOrdinal: number } | null {
    const row = this.history
      .prepare('SELECT * FROM projection_state WHERE session_id = ?')
      .get(sessionId) as ProjectionStateRow | undefined
    return row
      ? {
          rolloutPath: row.rollout_path,
          nextByteOffset: row.next_byte_offset,
          nextOrdinal: row.next_ordinal
        }
      : null
  }

  private setProjectionState(
    sessionId: string,
    rolloutPath: string,
    nextByteOffset: number,
    nextOrdinal: number
  ): void {
    this.history
      .prepare(
        `INSERT INTO projection_state (session_id, rollout_path, next_byte_offset, next_ordinal)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           rollout_path = excluded.rollout_path,
           next_byte_offset = excluded.next_byte_offset,
           next_ordinal = excluded.next_ordinal`
      )
      .run(sessionId, rolloutPath, nextByteOffset, nextOrdinal)
  }

  private deleteProjectionState(sessionId: string): void {
    this.history.prepare('DELETE FROM projection_state WHERE session_id = ?').run(sessionId)
  }

  private dropSession(sessionId: string): void {
    this.history.prepare('DELETE FROM turn_items WHERE session_id = ?').run(sessionId)
    this.history.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId)
    this.state.prepare('DELETE FROM threads WHERE session_id = ?').run(sessionId)
  }
}

function decodeThreadCursor(encoded: string): { pinned: number; time: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString())
    if (
      typeof value === 'object' &&
      value !== null &&
      'pinned' in value &&
      'time' in value &&
      'id' in value &&
      (value.pinned === 0 || value.pinned === 1) &&
      typeof value.time === 'string' &&
      typeof value.id === 'string'
    ) {
      return { pinned: value.pinned, time: value.time, id: value.id }
    }
  } catch {
    /* malformed cursor */
  }
  throw new Error('Invalid session catalog cursor')
}

type ThreadRow = {
  session_id: string
  title: string
  status: string
  model_connection_id: string
  model_id: string
  goal: string
  created_at: string
  updated_at: string
  pinned: number
  archived: number
  archived_at: string | null
  rollout_path: string
}

type TurnRow = {
  turn_id: string
  session_id: string
  rollout_ordinal: number
  end_ordinal: number | null
  goal: string
  status: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  error_json: string | null
}

type ItemRow = {
  turn_id: string
  item_id: string
  item_type: string
  rollout_ordinal: number
  updated_at_ordinal: number
  item_json: string
}

type ProjectionStateRow = {
  session_id: string
  rollout_path: string
  next_byte_offset: number
  next_ordinal: number
}

type StreamRequestRow = {
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

function streamRequestFromRow(row: StreamRequestRow): PersistedStreamRequest {
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

function threadFromRow(row: ThreadRow): ProjectedThread {
  return {
    sessionId: row.session_id,
    title: row.title,
    status: row.status,
    model: { connectionId: row.model_connection_id, modelId: row.model_id },
    goal: row.goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    rolloutPath: row.rollout_path
  }
}

function turnFromRow(row: TurnRow): ProjectedTurn {
  return {
    turnId: row.turn_id,
    sessionId: row.session_id,
    rolloutOrdinal: row.rollout_ordinal,
    endOrdinal: row.end_ordinal,
    goal: row.goal,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    error: row.error_json === null ? null : (JSON.parse(row.error_json) as unknown)
  }
}
