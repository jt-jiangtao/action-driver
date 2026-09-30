import type {
  EventRepository,
  MessageRepository,
  PersistedMessage,
  PersistedStreamRequest,
  PersistedToolInvocation,
  RuntimeEventRecord,
  RuntimeTaskRecord,
  StreamSessionRepository,
  StreamSnapshotRead,
  StreamRequestRepository,
  TaskRepository
} from '@action-driver/agent-runtime/ports'
import { countRolloutEvents } from './event-bridge'
import { applyRolloutLine, emptyRolloutState } from './fold'
import { assertPersistablePayload } from '../persistence-guard'
import { RolloutWriter, readRollout, sessionRolloutPath } from './log'
import type { RolloutLine, RolloutLineDraft } from './model'
import { RolloutProjection } from './projection'
import { RolloutReadOperations } from './read'
import { RolloutWriteOperations } from './write'
import { RolloutRecoveryOperations } from './recovery'
import type { RolloutStoreContext, SessionRuntime } from './store-context'

export type RolloutStoreOptions = {
  /** Root of the on-disk session log tree (the Codex `sessions/` parent). */
  sessionsRoot: string
  statePath: string
  historyPath: string
  now?: () => string
}

/**
 * Session persistence on top of the rollout log. Writes append domain records;
 * reads fold the log and derive the runtime events the stream protocol already
 * speaks. Nothing outside this class needs to know the storage changed.
 */
export class RolloutSessionStore implements StreamSessionRepository {
  private readonly projection: RolloutProjection
  private readonly sessions = new Map<string, SessionRuntime>()
  private readonly requests = new Map<string, PersistedStreamRequest>()
  private readonly taskSessions = new Map<string, string>()
  private readonly derivedCounts = new Map<string, number>()
  private readonly now: () => string
  private readonly reader: RolloutReadOperations
  private readonly writerOperations: RolloutWriteOperations
  private readonly recovery: RolloutRecoveryOperations

  readonly tasks: TaskRepository
  readonly messages: MessageRepository
  readonly events: EventRepository
  readonly streamRequests: StreamRequestRepository
  readonly toolInvocations: {
    listByTask(taskId: string): Promise<PersistedToolInvocation[]>
    save(invocation: PersistedToolInvocation): Promise<void>
  }

  constructor(private readonly options: RolloutStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.projection = RolloutProjection.open({
      statePath: options.statePath,
      historyPath: options.historyPath
    })
    for (const request of this.projection.listStreamRequests())
      this.requests.set(request.requestId, request)
    for (const turn of this.projection.listAllTurns())
      this.taskSessions.set(turn.turnId, turn.sessionId)
    const context: RolloutStoreContext = {
      requests: this.requests,
      taskSessions: this.taskSessions,
      projection: this.projection,
      now: this.now,
      ensureRuntime: (sessionId) => this.ensureRuntime(sessionId),
      runtimeFor: (sessionId, task) => this.runtimeFor(sessionId, task),
      appendLines: (runtime, lines) => this.appendLines(runtime, lines)
    }
    this.reader = new RolloutReadOperations(context)
    this.writerOperations = new RolloutWriteOperations(context)
    this.recovery = new RolloutRecoveryOperations(context)
    this.streamRequests = {
      getByRequestId: async (requestId) => this.requests.get(requestId) ?? null,
      getByTaskId: async (taskId) =>
        [...this.requests.values()].find((request) => request.taskId === taskId) ?? null,
      getByIdempotencyKey: async (idempotencyKey) =>
        [...this.requests.values()].find((request) => request.idempotencyKey === idempotencyKey) ??
        null
    }
    this.tasks = {
      get: async (taskId) => this.reader.taskRecord(taskId),
      getLatestBySession: async (sessionId) => this.reader.latestTask(sessionId),
      listBySession: async (sessionId) => this.reader.sessionTasks(sessionId),
      listRecent: async (limit) => this.reader.recentTasks(limit),
      listRecentSessions: async (limit) => this.reader.recentTasks(limit),
      save: async (task) => {
        this.writerOperations.saveTask(task)
      }
    }
    this.messages = {
      listByTask: async (taskId) => this.reader.messagesForTask(taskId),
      listBySession: async (sessionId) => {
        const tasks = await this.reader.sessionTasks(sessionId)
        const messages: PersistedMessage[] = []
        for (const task of tasks) messages.push(...(await this.reader.messagesForTask(task.id)))
        return messages
      },
      save: async (stored) => this.writerOperations.saveMessage(stored)
    }
    this.events = {
      append: async (event) => this.writerOperations.commitEvent(event),
      listAfter: async (cursor) => this.reader.listAfter(cursor),
      listForRequestAfter: async (requestId, cursor, limit) =>
        this.reader.listForRequestAfter(requestId, cursor, limit)
    }
    this.toolInvocations = {
      listByTask: async (taskId) => this.reader.toolsForTask(taskId),
      save: async (invocation) => this.writerOperations.saveToolInvocation(invocation)
    }
  }

  close(): void {
    for (const runtime of this.sessions.values()) runtime.writer.close()
    this.projection.close()
  }

  async createStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    userMessage: PersistedMessage
    assistantMessage: PersistedMessage
    acceptedEvent: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<{ created: boolean; request: PersistedStreamRequest }> {
    return this.writerOperations.createStreamTask(input)
  }

  async commitAssistantContentWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.writerOperations.commitAssistantContentWithEvent(request, message, event)
  }

  async commitAssistantImageWithEvent(
    request: PersistedStreamRequest,
    message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.writerOperations.commitAssistantImageWithEvent(request, message, event)
  }

  async finishStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    assistantMessage: PersistedMessage
    event: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<RuntimeEventRecord> {
    return this.writerOperations.finishStreamTask(input)
  }

  async readStreamSnapshot(requestId: string): Promise<StreamSnapshotRead> {
    return this.reader.readStreamSnapshot(requestId)
  }

  async recoverInterruptedRequests(code: string): Promise<RuntimeEventRecord[]> {
    return this.recovery.recoverInterruptedRequests(code)
  }

  async commitEvent(event: Omit<RuntimeEventRecord, 'cursor'>): Promise<RuntimeEventRecord> {
    return this.writerOperations.commitEvent(event)
  }

  async commitToolInvocationWithEvent(
    invocation: PersistedToolInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.writerOperations.commitToolInvocationWithEvent(invocation, event)
  }

  private runtimeFor(sessionId: string, task: RuntimeTaskRecord): SessionRuntime {
    const existing = this.ensureRuntime(sessionId)
    if (existing) return existing
    const path = sessionRolloutPath(this.options.sessionsRoot, sessionId)
    const runtime = this.loadRuntime(sessionId, path)
    const metaLine: RolloutLine = {
      t: 'session_meta',
      seq: 0,
      ts: task.createdAt,
      sessionId,
      threadId: sessionId,
      model: task.model,
      originator: 'action-driver-desktop',
      version: '0.1.0'
    }
    if (!runtime.lines.some((line) => line.t === 'session_meta'))
      this.appendLines(runtime, [metaLine])
    return runtime
  }

  /** Loads a session from disk when it is not already open in this process. */
  private ensureRuntime(sessionId: string): SessionRuntime | null {
    const open = this.sessions.get(sessionId)
    if (open) return open
    const thread = this.projection.getThread(sessionId)
    if (!thread || thread.rolloutPath.length === 0) return null
    return this.loadRuntime(sessionId, thread.rolloutPath)
  }

  private loadRuntime(sessionId: string, path: string): SessionRuntime {
    const { lines } = readRollout(path)
    const state = emptyRolloutState()
    for (const line of lines) applyRolloutLine(state, line)
    const runtime: SessionRuntime = {
      sessionId,
      path,
      writer: new RolloutWriter(path),
      lines,
      state
    }
    this.sessions.set(sessionId, runtime)
    return runtime
  }

  private appendLines(runtime: SessionRuntime, lines: readonly RolloutLineDraft[]): void {
    const appended: RolloutLine[] = []
    for (const line of lines) {
      const seq = runtime.state.cursor + 1
      const record = { ...line, seq } as RolloutLine
      assertPersistablePayload(record, 'rollout.record')
      runtime.writer.append(record)
      runtime.lines.push(record)
      applyRolloutLine(runtime.state, record)
      appended.push(record)
    }
    this.projection.project({ sessionId: runtime.sessionId, path: runtime.path })
    this.advanceWatermarks(appended)
  }

  /**
   * Keeps each request's published-sequence watermark current from the records just appended.
   * Folding the whole log here instead would make a long turn quadratic.
   */
  private advanceWatermarks(lines: readonly RolloutLine[]): void {
    for (const line of lines) {
      const added = countRolloutEvents(line)
      if (added === 0 || line.t === 'session_meta') continue
      const request = [...this.requests.values()].find((entry) => entry.taskId === line.turnId)
      if (!request) continue
      const next = (this.derivedCounts.get(request.requestId) ?? 0) + added
      this.derivedCounts.set(request.requestId, next)
      const updated: PersistedStreamRequest = { ...request, lastSequence: next - 1 }
      this.requests.set(request.requestId, updated)
      this.projection.saveStreamRequest(updated)
    }
  }
}
