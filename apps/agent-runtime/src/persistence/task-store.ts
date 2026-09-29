import type Database from 'better-sqlite3'
import type { PersistedMessage, RuntimeTaskRecord } from '../ports'
import { assertPersistablePayload } from '../persistence-guard'
import { nullableJson, parseNullableJson } from './json-columns'

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

export function saveTask(database: Database.Database, task: RuntimeTaskRecord): void {
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

export function saveMessage(database: Database.Database, message: PersistedMessage): void {
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

export function saveSkillInvocation(
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

export function taskFromRow(row: TaskRow): RuntimeTaskRecord {
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

export function messageFromRow(row: MessageRow): PersistedMessage {
  return {
    id: row.id,
    taskId: row.task_id,
    role: row.role,
    content: JSON.parse(row.content_json) as unknown,
    createdAt: row.created_at
  }
}

/**
 * Task, message, step and Skill-invocation tables share the caller's SQLite connection so
 * aggregate writes can stay inside one transaction.
 */
export function createTaskStore(database: Database.Database) {
  return {
    tasks: {
      get: async (taskId: string): Promise<RuntimeTaskRecord | null> => {
        const row = database.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
          | TaskRow
          | undefined
        return row ? taskFromRow(row) : null
      },
      getLatestBySession: async (sessionId: string): Promise<RuntimeTaskRecord | null> => {
        const row = database
          .prepare(
            'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
          )
          .get(sessionId) as TaskRow | undefined
        return row ? taskFromRow(row) : null
      },
      listBySession: async (sessionId: string): Promise<RuntimeTaskRecord[]> =>
        (
          database
            .prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at, id')
            .all(sessionId) as TaskRow[]
        ).map(taskFromRow),
      listRecent: async (limit: number): Promise<RuntimeTaskRecord[]> =>
        (
          database
            .prepare('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC LIMIT ?')
            .all(limit) as TaskRow[]
        ).map(taskFromRow),
      listRecentSessions: async (limit: number): Promise<RuntimeTaskRecord[]> =>
        (
          database
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
      save: async (task: RuntimeTaskRecord): Promise<void> => saveTask(database, task)
    },
    messages: {
      save: async (message: PersistedMessage): Promise<void> => saveMessage(database, message),
      listByTask: async (taskId: string): Promise<PersistedMessage[]> =>
        (
          database
            .prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at, rowid')
            .all(taskId) as MessageRow[]
        ).map(messageFromRow),
      listBySession: async (sessionId: string): Promise<PersistedMessage[]> =>
        (
          database
            .prepare(
              `SELECT messages.*
             FROM messages
             JOIN tasks ON tasks.id = messages.task_id
             WHERE tasks.session_id = ?
             ORDER BY tasks.created_at, tasks.id, messages.created_at, messages.rowid`
            )
            .all(sessionId) as MessageRow[]
        ).map(messageFromRow)
    },
    steps: {
      save: async (step: PersistedStep): Promise<void> => {
        database
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
          database
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
    },
    skillInvocations: {
      save: async (invocation: PersistedSkillInvocation): Promise<void> => {
        saveSkillInvocation(database, invocation)
      },
      listByTask: async (taskId: string): Promise<PersistedSkillInvocation[]> =>
        (
          database
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
  }
}

export type TaskRow = {
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

export type MessageRow = {
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
