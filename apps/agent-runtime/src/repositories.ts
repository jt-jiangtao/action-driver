import type Database from 'better-sqlite3'
import type { RuntimeEventRecord, RuntimeTaskRecord } from './ports'
import { assertPersistablePayload } from './persistence-guard'

export type PersistedMessage = {
  id: string
  taskId: string
  role: string
  content: unknown
  createdAt: string
}

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
    save: async (task: RuntimeTaskRecord): Promise<void> => saveTask(this.database, task)
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
  database
    .prepare(
      `INSERT INTO tasks (id, thread_id, goal, status, last_checkpoint_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, goal = excluded.goal,
        status = excluded.status, last_checkpoint_id = excluded.last_checkpoint_id,
        updated_at = excluded.updated_at`
    )
    .run(
      task.id,
      task.threadId,
      task.goal,
      task.status,
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
    status: row.status,
    lastCheckpointId: row.last_checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
  status: string
  last_checkpoint_id: string | null
  created_at: string
  updated_at: string
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
