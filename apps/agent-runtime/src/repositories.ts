import type Database from 'better-sqlite3'
import type {
  PersistedMessage,
  PersistedStreamRequest,
  PersistedToolInvocation,
  RuntimeEventRecord,
  RuntimeTaskRecord,
  StreamSnapshotRead
} from './ports'

export type { PersistedMessage, PersistedStreamRequest, PersistedToolInvocation } from './ports'
import { createInputFileStore } from './persistence/input-file-store'
import { createStreamStore, appendEvent, eventFromRow, streamRequestFromRow } from './persistence/stream-store'
import {
  createTaskStore,
  messageFromRow,
  saveMessage,
  saveSkillInvocation,
  saveTask,
  taskFromRow
} from './persistence/task-store'
import { saveStreamRequest } from './persistence/stream-store'
import type { PersistedSkillInvocation } from './persistence/task-store'
import { createToolStore, saveToolInvocation, toolInvocationFromRow } from './persistence/tool-store'
import type { EventRow, StreamRequestRow } from './persistence/stream-store'
import type { TaskRow, MessageRow } from './persistence/task-store'
import type { ToolInvocationRow } from './persistence/tool-store'

export type { PersistedSkillInvocation, PersistedStep } from './persistence/task-store'

/**
 * Composition entry for the SQLite persistence layer. Domain stores below share this single
 * connection; aggregate and cross-table writes stay in this class so each one runs inside one
 * `database.transaction(...).immediate()` boundary.
 */
export class SqliteRuntimeRepositories {
  readonly tasks
  readonly messages
  readonly inputFiles
  readonly steps
  readonly skillInvocations
  readonly toolInvocations
  readonly events
  readonly streamRequests

  constructor(private readonly database: Database.Database) {
    const taskStore = createTaskStore(database)
    const streamStore = createStreamStore(database)
    const toolStore = createToolStore(database)
    const inputFileStore = createInputFileStore(database)
    this.tasks = taskStore.tasks
    this.messages = taskStore.messages
    this.steps = taskStore.steps
    this.skillInvocations = taskStore.skillInvocations
    this.events = streamStore.events
    this.streamRequests = streamStore.streamRequests
    this.toolInvocations = toolStore.toolInvocations
    this.inputFiles = inputFileStore.inputFiles
  }

  async recoverInterruptedRequests(code: string): Promise<RuntimeEventRecord[]> {
    return this.database
      .transaction(() => {
        const requests = this.database
          .prepare(
            "SELECT * FROM stream_requests WHERE status = 'running' ORDER BY created_at, request_id"
          )
          .all() as StreamRequestRow[]
        const recovered: RuntimeEventRecord[] = []
        for (const row of requests) {
          const request = streamRequestFromRow(row)
          const taskRow = this.database
            .prepare('SELECT * FROM tasks WHERE id = ?')
            .get(request.taskId) as TaskRow | undefined
          if (!taskRow) throw new Error(`Missing task for stream request: ${request.requestId}`)
          const task = taskFromRow(taskRow)
          const occurredAt = new Date().toISOString()
          const error = {
            code,
            message: 'Runtime exited before this task completed',
            retryable: false as const
          }
          const runningTools = this.database
            .prepare(
              "SELECT * FROM tool_invocations WHERE task_id = ? AND status = 'running' ORDER BY created_at, id"
            )
            .all(task.id) as ToolInvocationRow[]
          for (const toolRow of runningTools) {
            const tool = toolInvocationFromRow(toolRow)
            saveToolInvocation(this.database, {
              ...tool,
              status: 'unknown',
              error: {
                code: 'TOOL_OUTCOME_UNKNOWN',
                message: 'Tool outcome is unknown after Runtime restart'
              },
              updatedAt: occurredAt
            })
            const previousRow = this.database
              .prepare(
                `SELECT payload_json FROM runtime_events
             WHERE request_id = ? AND event_type LIKE 'tool.%'
               AND json_extract(payload_json, '$.callId') = ?
             ORDER BY cursor DESC LIMIT 1`
              )
              .get(request.requestId, tool.id) as { payload_json: string } | undefined
            const previous = previousRow
              ? (JSON.parse(previousRow.payload_json) as Record<string, unknown>)
              : {}
            const previousCallSequence = previous.callSequence ?? previous.sequence
            recovered.push(
              appendEvent(this.database, {
                taskId: task.id,
                threadId: request.sessionId,
                checkpointId: request.responseId,
                eventKey: `recovery:tool.unknown:${tool.id}`,
                type: 'tool.unknown',
                payload: {
                  callId: tool.id,
                  toolId: tool.toolId,
                  modelName:
                    typeof previous.modelName === 'string'
                      ? previous.modelName
                      : tool.toolId.replaceAll('.', '_'),
                  summary: typeof previous.summary === 'string' ? previous.summary : tool.toolId,
                  argumentsHash: tool.argumentsHash,
                  activityId: typeof previous.activityId === 'string' ? previous.activityId : null,
                  input: tool.input,
                  callSequence:
                    (typeof previousCallSequence === 'number' ? previousCallSequence : -1) + 1,
                  error: {
                    code: 'TOOL_OUTCOME_UNKNOWN',
                    message: 'Tool outcome is unknown',
                    retryable: false
                  }
                },
                occurredAt,
                eventId: `recovery:tool.unknown:${tool.id}`,
                requestId: request.requestId,
                responseId: request.responseId,
                streamId: request.streamId,
                messageId: request.messageId,
                sequence: null
              })
            )
          }
          saveTask(this.database, { ...task, status: 'failed', error, updatedAt: occurredAt })
          this.database
            .prepare(
              "UPDATE stream_requests SET status = 'failed', updated_at = ? WHERE request_id = ? AND status = 'running'"
            )
            .run(occurredAt, request.requestId)
          recovered.push(
            appendEvent(this.database, {
              taskId: task.id,
              threadId: request.sessionId,
              checkpointId: request.responseId,
              eventKey: 'runtime.interrupted',
              type: 'runtime.interrupted',
              payload: { error },
              occurredAt,
              eventId: `runtime.interrupted:${request.requestId}`,
              requestId: request.requestId,
              responseId: request.responseId,
              streamId: request.streamId,
              messageId: request.messageId,
              sequence: null
            })
          )
        }
        return recovered
      })
      .immediate()
  }

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
        return {
          created: true,
          request: streamRequestFromRow(
            this.database
              .prepare('SELECT * FROM stream_requests WHERE request_id = ?')
              .get(input.request.requestId) as StreamRequestRow
          )
        }
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
             SET updated_at = ?
             WHERE request_id = ?`
          )
          .run(event.occurredAt, request.requestId)
        if (result.changes !== 1) throw new Error(`Unknown stream request: ${request.requestId}`)
        return appendEvent(this.database, event)
      })
      .immediate()
  }

  async commitAssistantImageWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.commitAssistantContentWithEvent(request, message, event)
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
             SET status = ?, updated_at = ?
             WHERE request_id = ?`
          )
          .run(input.request.status, input.request.updatedAt, input.request.requestId)
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
