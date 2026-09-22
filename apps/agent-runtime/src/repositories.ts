import type Database from 'better-sqlite3'
import type {
  PersistedMessage,
  PersistedModelCall,
  RuntimeEventRecord,
  RuntimeTaskRecord
} from './ports'

export type { PersistedMessage, PersistedModelCall } from './ports'
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
    listRecent: async (limit: number): Promise<RuntimeTaskRecord[]> =>
      (
        this.database
          .prepare('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC LIMIT ?')
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
    save: async (message: PersistedMessage): Promise<void> => {
      assertPersistablePayload(message.content, 'message.content')
      this.database
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
    },
    listByTask: async (taskId: string): Promise<PersistedMessage[]> =>
      (
        this.database
          .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at, id')
          .all(taskId) as MessageRow[]
      ).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        role: row.role,
        content: JSON.parse(row.content_json) as unknown,
        createdAt: row.created_at
      }))
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

  constructor(private readonly database: Database.Database) {}

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

  close(): void {
    this.database.close()
  }
}

function saveTask(database: Database.Database, task: RuntimeTaskRecord): void {
  assertPersistablePayload(task.error, 'task.error')
  database
    .prepare(
      `INSERT INTO tasks
        (id, thread_id, goal, connection_id, model_id, status, error_json,
         last_checkpoint_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, goal = excluded.goal,
        connection_id = excluded.connection_id, model_id = excluded.model_id,
        status = excluded.status, error_json = excluded.error_json,
        last_checkpoint_id = excluded.last_checkpoint_id, updated_at = excluded.updated_at`
    )
    .run(
      task.id,
      task.threadId,
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

function appendEvent(
  database: Database.Database,
  event: Omit<RuntimeEventRecord, 'cursor'>
): RuntimeEventRecord {
  assertPersistablePayload(event.payload, 'runtimeEvent.payload')
  const result = database
    .prepare(
      `INSERT INTO runtime_events
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

function taskFromRow(row: TaskRow): RuntimeTaskRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    goal: row.goal,
    model: { connectionId: row.connection_id, modelId: row.model_id },
    status: row.status,
    error: parseNullableJson(row.error_json),
    lastCheckpointId: row.last_checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
    occurredAt: row.occurred_at
  }
}

const nullableJson = (value: unknown | null): string | null =>
  value === null ? null : JSON.stringify(value)
const parseNullableJson = (value: string | null): unknown | null =>
  value === null ? null : (JSON.parse(value) as unknown)

type TaskRow = {
  id: string
  thread_id: string
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
}
