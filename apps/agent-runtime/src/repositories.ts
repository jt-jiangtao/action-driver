import type Database from 'better-sqlite3'
import type {
  PersistedMessage,
  PersistedModelCall,
  PersistedStreamRequest,
  PersistedToolInvocation,
  RuntimeEventRecord,
  RuntimeTaskRecord,
  StreamSnapshotRead
} from './ports'

export type {
  PersistedMessage,
  PersistedModelCall,
  PersistedStreamRequest,
  PersistedToolInvocation
} from './ports'
import { assertPersistablePayload } from './persistence-guard'

export type PersistedStep = {
  id: string
  taskId: string
  stepKey: string
  title: string
  detail: string
  status: string
  checkpointId: string | null
  createdAt: string
  updatedAt: string
}

export type PersistedSkillInvocation = {
  id: string
  taskId: string
  requestedSkillId: string
  resolvedProviderId: string | null
  providerVersion: string | null
  contractVersion: number
  status: string
  input: unknown
  output: unknown | null
  error: unknown | null
  createdAt: string
  updatedAt: string
}

export class SqliteRuntimeRepositories {
  readonly tasks = {
    get: async (taskId: string): Promise<RuntimeTaskRecord | null> => {
      const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
        | TaskRow
        | undefined
      return row ? taskFromRow(row) : null
    },
    getLatestBySession: async (sessionId: string): Promise<RuntimeTaskRecord | null> => {
      const row = this.database
        .prepare(
          'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
        )
        .get(sessionId) as TaskRow | undefined
      return row ? taskFromRow(row) : null
    },
    listBySession: async (sessionId: string): Promise<RuntimeTaskRecord[]> =>
      (
        this.database
          .prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at, id')
          .all(sessionId) as TaskRow[]
      ).map(taskFromRow),
    listRecent: async (limit: number): Promise<RuntimeTaskRecord[]> =>
      (
        this.database
          .prepare('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC LIMIT ?')
          .all(limit) as TaskRow[]
      ).map(taskFromRow),
    listRecentSessions: async (limit: number): Promise<RuntimeTaskRecord[]> =>
      (
        this.database
          .prepare(
            `SELECT latest.*
             FROM tasks latest
             WHERE latest.id = (
               SELECT candidate.id
               FROM tasks candidate
               WHERE candidate.session_id = latest.session_id
               ORDER BY candidate.updated_at DESC, candidate.id DESC
               LIMIT 1
             )
             ORDER BY latest.updated_at DESC, latest.id DESC
             LIMIT ?`
          )
          .all(limit) as TaskRow[]
      ).map(taskFromRow),
    save: async (task: RuntimeTaskRecord): Promise<void> => saveTask(this.database, task)
  }

  readonly modelCalls = {
    save: async (call: PersistedModelCall): Promise<void> => {
      assertPersistablePayload(call.request, 'modelCall.request')
      assertPersistablePayload(call.response, 'modelCall.response')
      assertPersistablePayload(call.error, 'modelCall.error')
      this.database
        .prepare(
          `INSERT INTO model_calls
            (id, task_id, request_id, correlation_id, connection_id, model_id, status,
             request_json, response_json, error_json, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status,
             response_json = excluded.response_json, error_json = excluded.error_json,
             completed_at = excluded.completed_at`
        )
        .run(
          call.id,
          call.taskId,
          call.requestId,
          call.correlationId,
          call.model.connectionId,
          call.model.modelId,
          call.status,
          JSON.stringify(call.request),
          nullableJson(call.response),
          nullableJson(call.error),
          call.startedAt,
          call.completedAt
        )
    },
    listByTask: async (taskId: string): Promise<PersistedModelCall[]> =>
      (
        this.database
          .prepare('SELECT * FROM model_calls WHERE task_id = ? ORDER BY started_at, id')
          .all(taskId) as ModelCallRow[]
      ).map(modelCallFromRow)
  }

  readonly messages = {
    save: async (message: PersistedMessage): Promise<void> => saveMessage(this.database, message),
    listByTask: async (taskId: string): Promise<PersistedMessage[]> =>
      (
        this.database
          .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at, rowid')
          .all(taskId) as MessageRow[]
      ).map(messageFromRow),
    listBySession: async (sessionId: string): Promise<PersistedMessage[]> =>
      (
        this.database
          .prepare(
            `SELECT messages.*
             FROM messages
             JOIN tasks ON tasks.id = messages.task_id
             WHERE tasks.session_id = ?
             ORDER BY tasks.created_at, tasks.id, messages.created_at, messages.rowid`
          )
          .all(sessionId) as MessageRow[]
      ).map(messageFromRow)
  }

  readonly steps = {
    save: async (step: PersistedStep): Promise<void> => {
      this.database
        .prepare(
          `INSERT INTO steps
            (id, task_id, step_key, title, detail, status, checkpoint_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, detail = excluded.detail,
            status = excluded.status, checkpoint_id = excluded.checkpoint_id, updated_at = excluded.updated_at`
        )
        .run(
          step.id,
          step.taskId,
          step.stepKey,
          step.title,
          step.detail,
          step.status,
          step.checkpointId,
          step.createdAt,
          step.updatedAt
        )
    },
    listByTask: async (taskId: string): Promise<PersistedStep[]> =>
      (
        this.database
          .prepare('SELECT * FROM steps WHERE task_id = ? ORDER BY created_at, id')
          .all(taskId) as StepRow[]
      ).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        stepKey: row.step_key,
        title: row.title,
        detail: row.detail,
        status: row.status,
        checkpointId: row.checkpoint_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
  }

  readonly skillInvocations = {
    save: async (invocation: PersistedSkillInvocation): Promise<void> => {
      saveSkillInvocation(this.database, invocation)
    },
    listByTask: async (taskId: string): Promise<PersistedSkillInvocation[]> =>
      (
        this.database
          .prepare('SELECT * FROM skill_invocations WHERE task_id = ? ORDER BY created_at, id')
          .all(taskId) as SkillRow[]
      ).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        requestedSkillId: row.requested_skill_id,
        resolvedProviderId: row.resolved_provider_id,
        providerVersion: row.provider_version,
        contractVersion: row.contract_version,
        status: row.status,
        input: JSON.parse(row.input_json) as unknown,
        output: parseNullableJson(row.output_json),
        error: parseNullableJson(row.error_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
  }

  readonly toolInvocations = {
    save: async (invocation: PersistedToolInvocation): Promise<void> => {
      saveToolInvocation(this.database, invocation)
    },
    listByTask: async (taskId: string): Promise<PersistedToolInvocation[]> =>
      (
        this.database
          .prepare('SELECT * FROM tool_invocations WHERE task_id = ? ORDER BY created_at, id')
          .all(taskId) as ToolInvocationRow[]
      ).map(toolInvocationFromRow)
  }

  readonly events = {
    append: async (event: Omit<RuntimeEventRecord, 'cursor'>): Promise<RuntimeEventRecord> =>
      appendEvent(this.database, event),
    listAfter: async (cursor: number): Promise<RuntimeEventRecord[]> =>
      (
        this.database
          .prepare('SELECT * FROM runtime_events WHERE cursor > ? ORDER BY cursor')
          .all(cursor) as EventRow[]
      ).map(eventFromRow)
  }

  readonly streamRequests = {
    getByRequestId: async (requestId: string): Promise<PersistedStreamRequest | null> => {
      const row = this.database
        .prepare('SELECT * FROM stream_requests WHERE request_id = ?')
        .get(requestId) as StreamRequestRow | undefined
      return row ? streamRequestFromRow(row) : null
    },
    getByTaskId: async (taskId: string): Promise<PersistedStreamRequest | null> => {
      const row = this.database
        .prepare('SELECT * FROM stream_requests WHERE task_id = ?')
        .get(taskId) as StreamRequestRow | undefined
      return row ? streamRequestFromRow(row) : null
    },
    getByIdempotencyKey: async (idempotencyKey: string): Promise<PersistedStreamRequest | null> => {
      const row = this.database
        .prepare('SELECT * FROM stream_requests WHERE idempotency_key = ?')
        .get(idempotencyKey) as StreamRequestRow | undefined
      return row ? streamRequestFromRow(row) : null
    }
  }

  constructor(private readonly database: Database.Database) {}

  async readStreamSnapshot(requestId: string): Promise<StreamSnapshotRead> {
    return this.database
      .transaction(() => {
        const requestRow = this.database
          .prepare('SELECT * FROM stream_requests WHERE request_id = ?')
          .get(requestId) as StreamRequestRow | undefined
        if (!requestRow) throw new Error(`Unknown stream request: ${requestId}`)
        const request = streamRequestFromRow(requestRow)
        const highWater = this.database
          .prepare('SELECT MAX(cursor) AS cursor FROM runtime_events WHERE request_id = ?')
          .get(requestId) as { cursor: number | null }
        const cursor = highWater.cursor ?? 0
        const events = (
          this.database
            .prepare(
              'SELECT * FROM runtime_events WHERE request_id = ? AND cursor <= ? ORDER BY cursor'
            )
            .all(requestId, cursor) as EventRow[]
        ).map(eventFromRow)
        const taskRow = this.database
          .prepare('SELECT * FROM tasks WHERE id = ?')
          .get(request.taskId) as TaskRow | undefined
        const messages = (
          this.database
            .prepare(
              `SELECT messages.* FROM messages
          JOIN tasks ON tasks.id = messages.task_id
          WHERE tasks.session_id = ?
          ORDER BY tasks.created_at, tasks.id, messages.created_at, messages.rowid`
            )
            .all(request.sessionId) as MessageRow[]
        ).map(messageFromRow)
        const tools = (
          this.database
            .prepare('SELECT * FROM tool_invocations WHERE task_id = ? ORDER BY created_at, id')
            .all(request.taskId) as ToolInvocationRow[]
        ).map(toolInvocationFromRow)
        return {
          request,
          cursor,
          events,
          task: taskRow ? taskFromRow(taskRow) : null,
          messages,
          tools
        }
      })
      .deferred()
  }

  async createStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    userMessage: PersistedMessage
    assistantMessage: PersistedMessage
    acceptedEvent: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<{ created: boolean; request: PersistedStreamRequest }> {
    return this.database
      .transaction(() => {
        const existing = this.database
          .prepare('SELECT * FROM stream_requests WHERE idempotency_key = ?')
          .get(input.request.idempotencyKey) as StreamRequestRow | undefined
        if (existing) return { created: false, request: streamRequestFromRow(existing) }

        saveTask(this.database, input.task)
        saveMessage(this.database, input.userMessage)
        saveMessage(this.database, input.assistantMessage)
        saveStreamRequest(this.database, input.request)
        appendEvent(this.database, input.acceptedEvent)
        return { created: true, request: input.request }
      })
      .immediate()
  }

  async commitAssistantContentWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        saveMessage(this.database, message)
        const result = this.database
          .prepare(
            `UPDATE stream_requests
             SET last_sequence = ?, updated_at = ?
             WHERE request_id = ?`
          )
          .run(event.sequence ?? request.lastSequence, event.occurredAt, request.requestId)
        if (result.changes !== 1) throw new Error(`Unknown stream request: ${request.requestId}`)
        return appendEvent(this.database, event)
      })
      .immediate()
  }

  async finishStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    assistantMessage: PersistedMessage
    event: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        saveMessage(this.database, input.assistantMessage)
        saveTask(this.database, input.task)
        const result = this.database
          .prepare(
            `UPDATE stream_requests
             SET status = ?, last_sequence = ?, updated_at = ?
             WHERE request_id = ?`
          )
          .run(
            input.request.status,
            input.request.lastSequence,
            input.request.updatedAt,
            input.request.requestId
          )
        if (result.changes !== 1) {
          throw new Error(`Unknown stream request: ${input.request.requestId}`)
        }
        return appendEvent(this.database, input.event)
      })
      .immediate()
  }

  async commitTaskStateWithEvent(
    task: RuntimeTaskRecord,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        saveTask(this.database, task)
        return appendEvent(this.database, event)
      })
      .immediate()
  }

  async projectCheckpoint(
    task: RuntimeTaskRecord,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<boolean> {
    assertPersistablePayload(event.payload, 'runtimeEvent.payload')
    return this.database
      .transaction(() => {
        saveTask(this.database, task)
        const result = this.database
          .prepare(
            `INSERT OR IGNORE INTO runtime_events
              (task_id, thread_id, checkpoint_id, event_key, event_type, payload_json, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            event.taskId,
            event.threadId,
            event.checkpointId,
            event.eventKey,
            event.type,
            JSON.stringify(event.payload),
            event.occurredAt
          )
        return result.changes === 1
      })
      .immediate()
  }

  async commitSkillInvocationWithEvent(
    invocation: PersistedSkillInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        saveSkillInvocation(this.database, invocation)
        return appendEvent(this.database, event)
      })
      .immediate()
  }

  async commitToolInvocationWithEvent(
    invocation: PersistedToolInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.database
      .transaction(() => {
        const existing = this.database
          .prepare(
            `SELECT * FROM runtime_events
             WHERE thread_id = ? AND checkpoint_id = ? AND event_key = ?`
          )
          .get(event.threadId, event.checkpointId, event.eventKey) as EventRow | undefined
        if (existing) return eventFromRow(existing)
        saveToolInvocation(this.database, invocation)
        return appendEvent(this.database, event)
      })
      .immediate()
  }

  close(): void {
    this.database.close()
  }
}

function saveTask(database: Database.Database, task: RuntimeTaskRecord): void {
  assertPersistablePayload(task.error, 'task.error')
  database
    .prepare(
      `INSERT INTO tasks
        (id, thread_id, session_id, goal, connection_id, model_id, status, error_json,
         last_checkpoint_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, goal = excluded.goal,
        session_id = excluded.session_id,
        connection_id = excluded.connection_id, model_id = excluded.model_id,
        status = excluded.status, error_json = excluded.error_json,
        last_checkpoint_id = excluded.last_checkpoint_id, updated_at = excluded.updated_at`
    )
    .run(
      task.id,
      task.threadId,
      task.sessionId,
      task.goal,
      task.model.connectionId,
      task.model.modelId,
      task.status,
      nullableJson(task.error),
      task.lastCheckpointId,
      task.createdAt,
      task.updatedAt
    )
}

function saveMessage(database: Database.Database, message: PersistedMessage): void {
  assertPersistablePayload(message.content, 'message.content')
  database
    .prepare(
      `INSERT INTO messages (id, task_id, role, content_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET role = excluded.role, content_json = excluded.content_json`
    )
    .run(
      message.id,
      message.taskId,
      message.role,
      JSON.stringify(message.content),
      message.createdAt
    )
}

function saveStreamRequest(database: Database.Database, request: PersistedStreamRequest): void {
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

function appendEvent(
  database: Database.Database,
  event: Omit<RuntimeEventRecord, 'cursor'>
): RuntimeEventRecord {
  assertPersistablePayload(event.payload, 'runtimeEvent.payload')
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
      JSON.stringify(event.payload),
      event.occurredAt,
      event.eventId ?? null,
      event.requestId ?? null,
      event.responseId ?? null,
      event.streamId ?? null,
      event.messageId ?? null,
      event.sequence ?? null
    )
  return { ...event, cursor: Number(result.lastInsertRowid) }
}

function saveSkillInvocation(
  database: Database.Database,
  invocation: PersistedSkillInvocation
): void {
  assertPersistablePayload(invocation.input, 'skillInvocation.input')
  assertPersistablePayload(invocation.output, 'skillInvocation.output')
  assertPersistablePayload(invocation.error, 'skillInvocation.error')
  database
    .prepare(
      `INSERT INTO skill_invocations
        (id, task_id, requested_skill_id, resolved_provider_id, provider_version, contract_version,
         status, input_json, output_json, error_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET resolved_provider_id = excluded.resolved_provider_id,
        provider_version = excluded.provider_version, status = excluded.status,
        output_json = excluded.output_json, error_json = excluded.error_json,
        updated_at = excluded.updated_at`
    )
    .run(
      invocation.id,
      invocation.taskId,
      invocation.requestedSkillId,
      invocation.resolvedProviderId,
      invocation.providerVersion,
      invocation.contractVersion,
      invocation.status,
      JSON.stringify(invocation.input),
      nullableJson(invocation.output),
      nullableJson(invocation.error),
      invocation.createdAt,
      invocation.updatedAt
    )
}

function saveToolInvocation(
  database: Database.Database,
  invocation: PersistedToolInvocation
): void {
  assertPersistablePayload(invocation.input, 'toolInvocation.input')
  assertPersistablePayload(invocation.output, 'toolInvocation.output')
  assertPersistablePayload(invocation.error, 'toolInvocation.error')
  database
    .prepare(
      `INSERT INTO tool_invocations
        (id, provider_call_id, task_id, tool_id, tool_version, arguments_hash, decision, status,
         input_json, output_json, error_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET decision = excluded.decision, status = excluded.status,
        output_json = excluded.output_json, error_json = excluded.error_json,
        updated_at = excluded.updated_at`
    )
    .run(
      invocation.id,
      invocation.providerCallId,
      invocation.taskId,
      invocation.toolId,
      invocation.toolVersion,
      invocation.argumentsHash,
      invocation.decision,
      invocation.status,
      JSON.stringify(invocation.input),
      nullableJson(invocation.output),
      nullableJson(invocation.error),
      invocation.createdAt,
      invocation.updatedAt
    )
}

function taskFromRow(row: TaskRow): RuntimeTaskRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    sessionId: row.session_id,
    goal: row.goal,
    model: { connectionId: row.connection_id, modelId: row.model_id },
    status: row.status,
    error: parseNullableJson(row.error_json),
    lastCheckpointId: row.last_checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function messageFromRow(row: MessageRow): PersistedMessage {
  return {
    id: row.id,
    taskId: row.task_id,
    role: row.role,
    content: JSON.parse(row.content_json) as unknown,
    createdAt: row.created_at
  }
}

function modelCallFromRow(row: ModelCallRow): PersistedModelCall {
  return {
    id: row.id,
    taskId: row.task_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    model: { connectionId: row.connection_id, modelId: row.model_id },
    status: row.status,
    request: JSON.parse(row.request_json) as unknown,
    response: parseNullableJson(row.response_json),
    error: parseNullableJson(row.error_json),
    startedAt: row.started_at,
    completedAt: row.completed_at
  }
}

function eventFromRow(row: EventRow): RuntimeEventRecord {
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

function toolInvocationFromRow(row: ToolInvocationRow): PersistedToolInvocation {
  return {
    id: row.id,
    providerCallId: row.provider_call_id,
    taskId: row.task_id,
    toolId: row.tool_id,
    toolVersion: row.tool_version,
    argumentsHash: row.arguments_hash,
    decision: row.decision,
    status: row.status,
    input: JSON.parse(row.input_json) as unknown,
    output: parseNullableJson(row.output_json),
    error: parseNullableJson(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const nullableJson = (value: unknown | null): string | null =>
  value === null ? null : JSON.stringify(value)
const parseNullableJson = (value: string | null): unknown | null =>
  value === null ? null : (JSON.parse(value) as unknown)

type TaskRow = {
  id: string
  thread_id: string
  session_id: string
  goal: string
  connection_id: string
  model_id: string
  status: string
  error_json: string | null
  last_checkpoint_id: string | null
  created_at: string
  updated_at: string
}
type ModelCallRow = {
  id: string
  task_id: string
  request_id: string
  correlation_id: string
  connection_id: string
  model_id: string
  status: PersistedModelCall['status']
  request_json: string
  response_json: string | null
  error_json: string | null
  started_at: string
  completed_at: string | null
}
type MessageRow = {
  id: string
  task_id: string
  role: string
  content_json: string
  created_at: string
}
type StepRow = {
  id: string
  task_id: string
  step_key: string
  title: string
  detail: string
  status: string
  checkpoint_id: string | null
  created_at: string
  updated_at: string
}
type SkillRow = {
  id: string
  task_id: string
  requested_skill_id: string
  resolved_provider_id: string | null
  provider_version: string | null
  contract_version: number
  status: string
  input_json: string
  output_json: string | null
  error_json: string | null
  created_at: string
  updated_at: string
}
type EventRow = {
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
type ToolInvocationRow = {
  id: string
  provider_call_id: string
  task_id: string
  tool_id: string
  tool_version: number
  arguments_hash: string
  decision: PersistedToolInvocation['decision']
  status: PersistedToolInvocation['status']
  input_json: string
  output_json: string | null
  error_json: string | null
  created_at: string
  updated_at: string
}
