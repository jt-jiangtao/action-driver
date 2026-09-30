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
} from '../ports'
import type { MessageContentPart } from '@actiondriver/contracts'
import { countRolloutEvents, deriveRolloutEvents } from './event-bridge'
import {
  applyRolloutLine,
  emptyRolloutState,
  nextOrder,
  type RolloutBlockState,
  type RolloutSessionState
} from './fold'
import { assertPersistablePayload } from '../persistence-guard'
import { RolloutWriter, readRollout, sessionRolloutPath } from './log'
import { imageAssetRefSchema, type RolloutLine, type RolloutLineDraft } from './model'
import { RolloutProjection } from './projection'

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
    this.streamRequests = {
      getByRequestId: async (requestId) => this.requests.get(requestId) ?? null,
      getByTaskId: async (taskId) =>
        [...this.requests.values()].find((request) => request.taskId === taskId) ?? null,
      getByIdempotencyKey: async (idempotencyKey) =>
        [...this.requests.values()].find(
          (request) => request.idempotencyKey === idempotencyKey
        ) ?? null
    }
    this.tasks = {
      get: async (taskId) => this.taskRecord(taskId),
      getLatestBySession: async (sessionId) => this.latestTask(sessionId),
      listBySession: async (sessionId) => this.sessionTasks(sessionId),
      listRecent: async (limit) => this.recentTasks(limit),
      listRecentSessions: async (limit) => this.recentTasks(limit),
      save: async (task) => {
        this.saveTask(task)
      }
    }
    this.messages = {
      listByTask: async (taskId) => this.messagesForTask(taskId),
      listBySession: async (sessionId) => {
        const tasks = await this.sessionTasks(sessionId)
        const messages: PersistedMessage[] = []
        for (const task of tasks) messages.push(...(await this.messagesForTask(task.id)))
        return messages
      },
      save: async (stored) => this.saveMessage(stored)
    }
    this.events = {
      append: async (event) => this.commitEvent(event),
      listAfter: async (cursor) => this.listAfter(cursor),
      listForRequestAfter: async (requestId, cursor, limit) =>
        this.listForRequestAfter(requestId, cursor, limit)
    }
    this.toolInvocations = {
      listByTask: async (taskId) => this.toolsForTask(taskId),
      save: async (invocation) => this.saveToolInvocation(invocation)
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
    const existing = await this.streamRequests.getByTaskId(input.request.taskId)
    if (existing) return { created: false, request: existing }
    this.requests.set(input.request.requestId, input.request)
    this.projection.saveStreamRequest(input.request)
    this.taskSessions.set(input.request.taskId, input.request.sessionId)
    const runtime = this.runtimeFor(input.request.sessionId, input.task)
    // The acceptance record precedes the turn so its persisted order matches the order the
    // service published historically (accepted first, then the turn's response.start).
    this.appendLines(runtime, [
      {
        t: 'event',
        ts: input.acceptedEvent.occurredAt,
        turnId: input.request.taskId,
        type: 'request.accepted',
        payload: {}
      },
      { t: 'turn_begin', ts: input.request.createdAt, turnId: input.request.taskId, taskId: input.request.taskId, goal: input.task.goal },
      {
        t: 'message',
        ts: input.userMessage.createdAt,
        turnId: input.request.taskId,
        messageId: input.userMessage.id,
        role: 'user',
        content: input.userMessage.content
      },
      {
        // The assistant message must exist from the start: the renderer routes streamed events by
        // its id, so a snapshot taken mid-turn has to already carry it.
        t: 'message',
        ts: input.assistantMessage.createdAt,
        turnId: input.request.taskId,
        messageId: input.assistantMessage.id,
        role: 'assistant',
        content: input.assistantMessage.content
      }
    ])
    return { created: true, request: input.request }
  }

  async commitAssistantContentWithEvent(
    request: PersistedStreamRequest,
    _message: PersistedMessage,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    return this.commitEvent(event)
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
    this.requests.set(input.request.requestId, input.request)
    this.projection.saveStreamRequest(input.request)
    const runtime = this.ensureRuntime(input.request.sessionId)
    const turn = runtime?.state.turns.find(
      (candidate) => candidate.turnId === input.request.taskId
    )
    const answer = (input.event.payload as { content?: unknown }).content
    if (runtime && turn && typeof answer === 'string' && answer.length > 0) {
      const streamed = turn.blocks
        .filter((block) => block.kind === 'text')
        .map((block) => block.text)
        .join('')
      // Only an answer the model never streamed becomes its own block; anything already in the
      // transcript keeps its streamed position, mirroring the stored transcript.
      if (
        streamed.length === 0 ||
        (!streamed.endsWith(answer) && !answer.endsWith(streamed))
      ) {
        this.appendLines(runtime, [
          {
            t: 'block',
            ts: input.event.occurredAt,
            turnId: input.request.taskId,
            blockId: `text:${input.request.taskId}:final`,
            kind: 'text',
            order: nextOrder(turn.blocks),
            slots: 1,
            status: 'completed',
            text: answer,
            phase: 'final'
          }
        ])
      }
    }
    return this.commitEvent(input.event)
  }

  async readStreamSnapshot(requestId: string): Promise<StreamSnapshotRead> {
    const request = this.requests.get(requestId)
    if (!request) throw new Error(`Unknown stream request: ${requestId}`)
    const runtime = this.ensureRuntime(request.sessionId)
    const lines = runtime?.lines ?? []
    const events = deriveRolloutEvents(lines, request)
    // Snapshots read this watermark, so it is refreshed whenever the log is folded rather than on
    // every append — folding the whole log per event would be quadratic across a long turn.
    const lastSequence = events.at(-1)?.sequence ?? null
    if (lastSequence !== null && lastSequence !== request.lastSequence) {
      const updated: PersistedStreamRequest = { ...request, lastSequence }
      this.requests.set(request.requestId, updated)
      this.projection.saveStreamRequest(updated)
    }
    let cursor = 0
    for (const event of events) cursor = Math.max(cursor, event.cursor)
    return {
      request,
      cursor,
      events,
      task: await this.taskRecord(request.taskId),
      messages: await this.messagesForTask(request.taskId),
      tools: await this.toolsForTask(request.taskId)
    }
  }

  /**
   * Idempotently ends requests that were still running when the process exited.
   * Only terminal records are appended; nothing already written is rewritten and
   * no tool is executed again.
   */
  async recoverInterruptedRequests(code: string): Promise<RuntimeEventRecord[]> {
    const recovered: RuntimeEventRecord[] = []
    for (const request of this.projection.listStreamRequests()) {
      if (request.status !== 'running') continue
      const runtime = this.ensureRuntime(request.sessionId)
      if (!runtime) continue
      const turn = runtime.state.turns.find((candidate) => candidate.turnId === request.taskId)
      if (!turn) continue
      const at = this.now()
      const drafts: RolloutLineDraft[] = []
      for (const tool of turn.tools.values()) {
        if (!['proposed', 'waiting_approval', 'queued', 'running'].includes(tool.status)) continue
        drafts.push({
          t: 'tool',
          ts: at,
          turnId: turn.turnId,
          blockId: tool.blockId,
          callId: tool.callId,
          itemIndex: tool.itemIndex,
          toolId: tool.toolId,
          modelName: tool.modelName,
          status: 'unknown',
          errorSummary: 'Tool outcome is unknown after Runtime restart'
        })
      }
      drafts.push({
        t: 'turn_end',
        ts: at,
        turnId: turn.turnId,
        status: 'failed',
        error: { code, message: 'Runtime exited before this task completed', retryable: false }
      })
      drafts.push({
        t: 'event',
        ts: at,
        turnId: turn.turnId,
        type: 'runtime.interrupted',
        payload: {
          error: { code, message: 'Runtime exited before this task completed', retryable: false }
        }
      })
      this.appendLines(runtime, drafts)
      const updated: PersistedStreamRequest = { ...request, status: 'failed', updatedAt: at }
      this.requests.set(request.requestId, updated)
      this.projection.saveStreamRequest(updated)
      recovered.push(...deriveRolloutEvents(runtime.lines, updated))
    }
    return recovered
  }

  /** Persists one runtime event as a domain record; tool state is derived from the log. */
  async commitEvent(
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    const request = event.requestId ? this.requests.get(event.requestId) : undefined
    const sessionId = request?.sessionId ?? this.taskSessions.get(event.taskId)
    if (!sessionId) throw new Error(`Unknown session for task: ${event.taskId}`)
    const runtime = this.ensureRuntime(sessionId)
    if (!runtime) throw new Error(`Unknown session: ${sessionId}`)
    // Agent-mode tasks have no stream request; the turn itself anchors the record.
    const anchor: PersistedStreamRequest = request ?? {
      requestId: event.requestId ?? `event:${event.taskId}`,
      idempotencyKey: `event:${event.taskId}`,
      sessionId,
      taskId: event.taskId,
      responseId: event.responseId ?? '',
      streamId: event.streamId ?? '',
      messageId: event.messageId ?? '',
      status: 'running',
      lastSequence: -1,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt
    }
    const record = recordForEvent(event, anchor, runtime.state)
    const drafts: RolloutLineDraft[] = []
    // A tool whose group was never announced still needs its group block, otherwise the reopened
    // transcript would lose the anchor that keeps prose and tools in order.
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const activityId = typeof payload.activityId === 'string' ? payload.activityId : null
    const turn = runtime.state.turns.find((candidate) => candidate.turnId === event.taskId)
    if (
      activityId !== null &&
      turn !== undefined &&
      !turn.blocks.some((block) => block.blockId === activityId)
    ) {
      drafts.push({
        t: 'block',
        ts: event.occurredAt,
        turnId: event.taskId,
        blockId: activityId,
        kind: 'tool_group',
        order: nextOrder(turn.blocks),
        slots: 1,
        status: 'pending'
      })
    }
    if (record) drafts.push(record)
    if (drafts.length > 0) this.appendLines(runtime, drafts)
    const cursor = runtime.state.cursor
    return { ...event, cursor: cursor < 0 ? 0 : cursor }
  }

  /** The tool's own state lives in the log, so persisting a call is appending its event. */
  async commitToolInvocationWithEvent(
    invocation: PersistedToolInvocation,
    event: Omit<RuntimeEventRecord, 'cursor'>
  ): Promise<RuntimeEventRecord> {
    // The invocation's own input/output must survive too: reopened snapshots rebuild declared
    // details from them, not from the event frame.
    this.saveToolInvocation(invocation)
    return this.commitEvent(event)
  }

  private async listAfter(cursor: number): Promise<RuntimeEventRecord[]> {
    const events: RuntimeEventRecord[] = []
    for (const request of this.requests.values()) {
      events.push(...deriveRolloutEvents(this.ensureRuntime(request.sessionId)?.lines ?? [], request))
    }
    return events.filter((event) => event.cursor > cursor).sort((left, right) => left.cursor - right.cursor)
  }

  private async listForRequestAfter(
    requestId: string,
    cursor: number,
    limit: number
  ): Promise<RuntimeEventRecord[]> {
    const request = this.requests.get(requestId)
    if (!request) return []
    const events = deriveRolloutEvents(
      this.ensureRuntime(request.sessionId)?.lines ?? [],
      request
    ).filter((event) => event.cursor > cursor)
    return events.slice(0, limit)
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
      originator: 'actiondriver-desktop',
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
    const runtime: SessionRuntime = { sessionId, path, writer: new RolloutWriter(path), lines, state }
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

  private async taskRecord(taskId: string): Promise<RuntimeTaskRecord | null> {
    const sessionId =
      this.taskSessions.get(taskId) ??
      [...this.requests.values()].find((candidate) => candidate.taskId === taskId)?.sessionId
    if (!sessionId) return null
    const state = this.ensureRuntime(sessionId)?.state
    const turn = state?.turns.find((candidate) => candidate.turnId === taskId)
    if (!turn) return null
    const request = [...this.requests.values()].find((candidate) => candidate.taskId === taskId)
    return {
      id: taskId,
      threadId: sessionId,
      sessionId,
      goal: turn.goal,
      model: state?.model ?? { connectionId: '', modelId: '' },
      status: turn.status,
      error: turn.error,
      lastCheckpointId: null,
      createdAt: turn.startedAt ?? request?.createdAt ?? '',
      updatedAt: turn.completedAt ?? turn.startedAt ?? request?.createdAt ?? ''
    }
  }

  private async latestTask(sessionId: string): Promise<RuntimeTaskRecord | null> {
    const tasks = await this.sessionTasks(sessionId)
    return tasks.at(-1) ?? null
  }

  private async sessionTasks(sessionId: string): Promise<RuntimeTaskRecord[]> {
    const state = this.ensureRuntime(sessionId)?.state
    if (!state) return []
    const tasks: RuntimeTaskRecord[] = []
    for (const turn of state.turns) {
      const record = await this.taskRecord(turn.turnId)
      if (record) tasks.push(record)
    }
    return tasks
  }

  /** Recent sessions, newest first, one task (the latest turn) per session. */
  private async recentTasks(limit: number): Promise<RuntimeTaskRecord[]> {
    const tasks: RuntimeTaskRecord[] = []
    for (const thread of this.projection.listThreads(limit)) {
      const latest = await this.latestTask(thread.sessionId)
      if (latest) tasks.push(latest)
    }
    return tasks
  }

  private saveTask(task: RuntimeTaskRecord): void {
    this.taskSessions.set(task.id, task.sessionId)
    const runtime = this.runtimeFor(task.sessionId, task)
    const turn = runtime.state.turns.find((candidate) => candidate.turnId === task.id)
    const terminal =
      task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted'
    const endStatus =
      task.status === 'completed'
        ? 'completed'
        : task.status === 'interrupted'
          ? 'cancelled'
          : 'failed'
    const endDraft = (): RolloutLineDraft => ({
      t: 'turn_end',
      ts: task.updatedAt,
      turnId: task.id,
      status: endStatus,
      ...(task.error === null || task.error === undefined ? {} : { error: task.error })
    })
    if (!turn) {
      this.appendLines(runtime, [
        {
          t: 'turn_begin',
          ts: task.createdAt,
          turnId: task.id,
          taskId: task.id,
          goal: task.goal
        }
      ])
      // A task that is already terminal when first saved still needs its closing record.
      if (terminal) this.appendLines(runtime, [endDraft()])
      return
    }
    // The fold keeps the last terminal record, so a later status wins — matching the old
    // upsert — while an unchanged status appends nothing.
    if (!terminal || turn.status === endStatus) return
    this.appendLines(runtime, [endDraft()])
  }

  private saveMessage(stored: PersistedMessage): void {
    const sessionId = this.taskSessions.get(stored.taskId)
    if (!sessionId) return
    const runtime = this.ensureRuntime(sessionId)
    if (!runtime) return
    this.appendLines(runtime, [
      {
        t: 'message',
        ts: stored.createdAt,
        turnId: stored.taskId,
        messageId: stored.id,
        role: stored.role === 'user' || stored.role === 'tool' ? stored.role : 'assistant',
        content: stored.content
      }
    ])
  }

  /** Seeding or restoring one tool call is one appended record; the fold owns the rest. */
  private saveToolInvocation(invocation: PersistedToolInvocation): void {
    const sessionId = this.taskSessions.get(invocation.taskId)
    if (!sessionId) return
    const runtime = this.ensureRuntime(sessionId)
    if (!runtime) return
    const turn = runtime.state.turns.find((candidate) => candidate.turnId === invocation.taskId)
    const existing = turn?.tools.get(invocation.id)
    this.appendLines(runtime, [
      {
        t: 'tool',
        ts: invocation.updatedAt,
        turnId: invocation.taskId,
        blockId: existing?.blockId ?? `tool-group:${invocation.taskId}`,
        callId: invocation.id,
        itemIndex: existing?.itemIndex ?? (turn?.tools.size ?? 0),
        toolId: invocation.toolId,
        modelName: existing?.modelName ?? invocation.toolId,
        status: invocation.status,
        argumentsHash: invocation.argumentsHash,
        ...(invocation.input === null || invocation.input === undefined
          ? {}
          : { input: invocation.input }),
        ...(invocation.output === null || invocation.output === undefined
          ? {}
          : { output: invocation.output })
      }
    ])
  }

  private async messagesForTask(taskId: string): Promise<PersistedMessage[]> {
    const sessionId =
      this.taskSessions.get(taskId) ??
      [...this.requests.values()].find((candidate) => candidate.taskId === taskId)?.sessionId
    if (!sessionId) return []
    const state = this.ensureRuntime(sessionId)?.state
    const turn = state?.turns.find((candidate) => candidate.turnId === taskId)
    if (!turn) return []
    const request = [...this.requests.values()].find((candidate) => candidate.taskId === taskId)
    const stored: PersistedMessage[] = turn.messages.map((message) => ({
      id: message.messageId,
      taskId,
      role: message.role,
      content: message.content,
      createdAt: message.at
    }))
    const parts = turn.blocks.map((block) => blockToPart(block)).filter((part) => part !== null)
    if (parts.length === 0 && turn.finalContent.length === 0) return stored
    // A text-only turn keeps the plain `{ text }` shape; parts appear once the turn carries
    // images, documents or tool-group anchors.
    const structured = parts.some(
      (part) =>
        part.kind === 'image' ||
        part.kind === 'image-batch' ||
        part.kind === 'document' ||
        part.kind === 'activity'
    )
    const streamedText = parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('')
    const assistantId = request?.messageId ?? `assistant:${taskId}`
    const content = structured
      ? { parts }
      : { text: streamedText.length > 0 ? streamedText : turn.finalContent }
    const index = stored.findIndex(
      (message) => message.id === assistantId && message.role === 'assistant'
    )
    if (index >= 0) {
      // Keep the id the streamed events address; only the content grows.
      stored[index] = { ...stored[index]!, content }
      return stored
    }
    return [
      ...stored,
      {
        id: assistantId,
        taskId,
        role: 'assistant',
        content,
        createdAt: turn.completedAt ?? turn.startedAt ?? request?.createdAt ?? ''
      }
    ]
  }

  private async toolsForTask(taskId: string): Promise<PersistedToolInvocation[]> {
    const sessionId =
      this.taskSessions.get(taskId) ??
      [...this.requests.values()].find((candidate) => candidate.taskId === taskId)?.sessionId
    if (!sessionId) return []
    const state = this.ensureRuntime(sessionId)?.state
    const turn = state?.turns.find((candidate) => candidate.turnId === taskId)
    if (!turn) return []
    return [...turn.tools.values()].map((tool) => ({
      id: tool.callId,
      providerCallId: tool.callId,
      taskId,
      toolId: tool.toolId,
      toolVersion: 0,
      argumentsHash: tool.argumentsHash,
      decision: 'allow',
      status: tool.status,
      input: tool.input,
      output: tool.output,
      error: null,
      createdAt: turn.startedAt ?? '',
      updatedAt: turn.completedAt ?? turn.startedAt ?? ''
    }))
  }
}

type SessionRuntime = {
  sessionId: string
  path: string
  writer: RolloutWriter
  lines: RolloutLine[]
  state: RolloutSessionState
}

/**
 * A block keeps the slot it was first given; updates must repeat that slot so a
 * reopened log folds to the same position.
 */
function orderFor(
  turn: { blocks: Array<{ blockId: string; order: number }> } | undefined,
  blockId: string,
  fallback: number
): number {
  return turn?.blocks.find((block) => block.blockId === blockId)?.order ?? fallback
}

function blockToPart(block: RolloutBlockState): MessageContentPart | null {
  if (block.kind === 'text') return { kind: 'text', text: block.text, order: block.order }
  if (block.kind === 'image_batch')
    return block.callId !== null && block.imageCount !== null
      ? {
          kind: 'image-batch',
          callId: block.callId,
          imageCount: block.imageCount,
          order: block.order
        }
      : null
  if (block.kind === 'image')
    return block.asset !== null
      ? {
          kind: 'image',
          asset: block.asset,
          ...(block.generation === null ? {} : { generation: block.generation }),
          order: block.order
        }
      : null
  if (block.kind === 'document')
    return block.file !== null ? { kind: 'document', file: block.file, order: block.order } : null
  // A tool group keeps an anchor part so a reopened transcript matches the live one.
  if (block.kind === 'tool_group')
    return { kind: 'activity', activityId: block.blockId, order: block.order }
  return null
}

/** Maps one persisted runtime event to the domain record that carries it. */
function recordForEvent(
  event: Omit<RuntimeEventRecord, 'cursor'>,
  request: PersistedStreamRequest,
  state: RolloutSessionState
): RolloutLineDraft | null {
  const turnId = request.taskId
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const turn = state.turns.find((candidate) => candidate.turnId === turnId)
  const next = turn ? nextOrder(turn.blocks) : 1
  const order = typeof payload.order === 'number' ? payload.order : next
  // `turn_begin` already derives this request's response.start, so the service's own copy would
  // publish a duplicate frame.
  if (event.type === 'response.start') return null
  if (event.type === 'response.content') {
    const delta = typeof payload.delta === 'string' ? payload.delta : ''
    if (!delta) return null
    const trailing = turn?.blocks.find(
      (block) => block.kind === 'text' && block.order === order
    )
    return {
      t: 'block',
      ts: event.occurredAt,
      turnId,
      blockId: trailing?.blockId ?? `text:${turnId}:${order}`,
      kind: 'text',
      order,
      slots: 1,
      status: 'streaming',
      delta,
      phase: 'pending'
    }
  }
  // The narration channel keeps its own record so the published stream stays one event per record.
  if (event.type === 'activity.text') {
    return {
      t: 'activity_text',
      ts: event.occurredAt,
      turnId,
      textId: String(payload.textId ?? `text:${turnId}`),
      activityId: typeof payload.activityId === 'string' ? payload.activityId : null,
      ...(typeof payload.delta === 'string' ? { delta: payload.delta } : {})
    }
  }
  if (event.type === 'activity.text.done') {
    const phase = payload.phase === 'process' || payload.phase === 'final' ? payload.phase : 'pending'
    return {
      t: 'activity_text',
      ts: event.occurredAt,
      turnId,
      textId: String(payload.textId),
      activityId: typeof payload.activityId === 'string' ? payload.activityId : null,
      ...(phase === 'process' || phase === 'final' ? { phase } : {})
    }
  }
  if (event.type === 'response.image_batch') {
    const imageCount = typeof payload.imageCount === 'number' ? payload.imageCount : 1
    return {
      t: 'block',
      ts: event.occurredAt,
      turnId,
      blockId: `batch:${String(payload.callId)}`,
      kind: 'image_batch',
      order,
      slots: 1 + imageCount,
      status: 'pending',
      callId: String(payload.callId),
      imageCount
    }
  }
  if (event.type === 'response.image') {
    const asset = imageAssetRefSchema.safeParse(payload.asset).data
    return {
      t: 'block',
      ts: event.occurredAt,
      turnId,
      blockId: `image:${String(payload.callId)}:${String(payload.index ?? 0)}`,
      kind: 'image',
      order,
      slots: 1,
      status: 'completed',
      ...(asset === undefined ? {} : { asset }),
      generation: { callId: String(payload.callId), index: Number(payload.index ?? 0) }
    }
  }
  if (event.type === 'activity.started' || event.type === 'activity.updated') {
    const activityId = String(payload.activityId)
    return {
      t: 'block',
      ts: event.occurredAt,
      turnId,
      blockId: activityId,
      kind: 'tool_group',
      order: orderFor(turn, activityId, order),
      slots: 1,
      status: 'pending',
      title: typeof payload.title === 'string' ? payload.title : undefined,
      titleRevision: typeof payload.titleRevision === 'number' ? payload.titleRevision : 1
    }
  }
  if (event.type === 'activity.completed') {
    const activityId = String(payload.activityId)
    return {
      t: 'block',
      ts: event.occurredAt,
      turnId,
      blockId: activityId,
      kind: 'tool_group',
      order: orderFor(turn, activityId, order),
      slots: 1,
      status: 'completed'
    }
  }
  if (event.type.startsWith('tool.')) {
    // Asset and content frames are not tool states, but a reopened snapshot still reads them to
    // rebuild declared details, so they are stored verbatim.
    if (event.type === 'tool.asset' || event.type === 'tool.content')
      return { t: 'event', ts: event.occurredAt, turnId, type: event.type, payload: event.payload }
    const activityId = typeof payload.activityId === 'string' ? payload.activityId : null
    return {
      t: 'tool',
      ts: event.occurredAt,
      turnId,
      blockId: activityId ?? `tool-group:${turnId}`,
      callId: String(payload.callId),
      // Legacy frames carry only the request sequence; the old store promoted it to callSequence.
      itemIndex:
        typeof payload.callSequence === 'number'
          ? payload.callSequence
          : typeof event.sequence === 'number'
            ? event.sequence
            : 0,
      toolId: String(payload.toolId ?? 'tool'),
      modelName: String(payload.modelName ?? 'tool'),
      status: event.type.slice('tool.'.length) as never,
      summary: typeof payload.summary === 'string' ? payload.summary : undefined,
      argumentsHash: typeof payload.argumentsHash === 'string' ? payload.argumentsHash : undefined,
      ...(payload.input === undefined ? {} : { input: payload.input }),
      ...(payload.output === undefined ? {} : { output: payload.output }),
      ...(payload.presentation === undefined ? {} : { presentation: payload.presentation })
    }
  }
  if (event.type === 'response.end') {
    return {
      t: 'turn_end',
      ts: event.occurredAt,
      turnId,
      status: payload.status === 'completed' || payload.status === 'cancelled' ? payload.status : 'failed',
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
      content: typeof payload.content === 'string' ? payload.content : undefined,
      ...(payload.error === undefined || payload.error === null ? {} : { error: payload.error })
    }
  }
  return { t: 'event', ts: event.occurredAt, turnId, type: event.type, payload: event.payload }
}
