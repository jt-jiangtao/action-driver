import type {
  PersistedMessage,
  PersistedStreamRequest,
  PersistedToolInvocation,
  RuntimeEventRecord,
  RuntimeTaskRecord
} from '@action-driver/agent-runtime/ports'
import { nextOrder, type RolloutSessionState } from './fold'
import { imageAssetRefSchema, type RolloutLineDraft } from './model'
import type { RolloutStoreContext } from './store-context'

export class RolloutWriteOperations {
  constructor(private readonly context: RolloutStoreContext) {}

  async createStreamTask(input: {
    request: PersistedStreamRequest
    task: RuntimeTaskRecord
    userMessage: PersistedMessage
    assistantMessage: PersistedMessage
    acceptedEvent: Omit<RuntimeEventRecord, 'cursor'>
  }): Promise<{ created: boolean; request: PersistedStreamRequest }> {
    const existing = [...this.context.requests.values()].find(
      (request) => request.taskId === input.request.taskId
    )
    if (existing) return { created: false, request: existing }
    this.context.requests.set(input.request.requestId, input.request)
    this.context.projection.saveStreamRequest(input.request)
    this.context.taskSessions.set(input.request.taskId, input.request.sessionId)
    const runtime = this.context.runtimeFor(input.request.sessionId, input.task)
    // The acceptance record precedes the turn so its persisted order matches the order the
    // service published historically (accepted first, then the turn's response.start).
    this.context.appendLines(runtime, [
      {
        t: 'event',
        ts: input.acceptedEvent.occurredAt,
        turnId: input.request.taskId,
        type: 'request.accepted',
        payload: {}
      },
      {
        t: 'turn_begin',
        ts: input.request.createdAt,
        turnId: input.request.taskId,
        taskId: input.request.taskId,
        goal: input.task.goal
      },
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
    this.context.requests.set(input.request.requestId, input.request)
    this.context.projection.saveStreamRequest(input.request)
    const runtime = this.context.ensureRuntime(input.request.sessionId)
    const turn = runtime?.state.turns.find((candidate) => candidate.turnId === input.request.taskId)
    const answer = (input.event.payload as { content?: unknown }).content
    if (runtime && turn && typeof answer === 'string' && answer.length > 0) {
      const streamed = turn.blocks
        .filter((block) => block.kind === 'text')
        .map((block) => block.text)
        .join('')
      // Only an answer the model never streamed becomes its own block; anything already in the
      // transcript keeps its streamed position, mirroring the stored transcript.
      if (streamed.length === 0 || (!streamed.endsWith(answer) && !answer.endsWith(streamed))) {
        this.context.appendLines(runtime, [
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

  async commitEvent(event: Omit<RuntimeEventRecord, 'cursor'>): Promise<RuntimeEventRecord> {
    const request = event.requestId ? this.context.requests.get(event.requestId) : undefined
    const sessionId = request?.sessionId ?? this.context.taskSessions.get(event.taskId)
    if (!sessionId) throw new Error(`Unknown session for task: ${event.taskId}`)
    const runtime = this.context.ensureRuntime(sessionId)
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
    if (drafts.length > 0) this.context.appendLines(runtime, drafts)
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

  saveTask(task: RuntimeTaskRecord): void {
    this.context.taskSessions.set(task.id, task.sessionId)
    const runtime = this.context.runtimeFor(task.sessionId, task)
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
      this.context.appendLines(runtime, [
        {
          t: 'turn_begin',
          ts: task.createdAt,
          turnId: task.id,
          taskId: task.id,
          goal: task.goal
        }
      ])
      // A task that is already terminal when first saved still needs its closing record.
      if (terminal) this.context.appendLines(runtime, [endDraft()])
      return
    }
    // The fold keeps the last terminal record, so a later status wins — matching the old
    // upsert — while an unchanged status appends nothing.
    if (!terminal || turn.status === endStatus) return
    this.context.appendLines(runtime, [endDraft()])
  }

  saveMessage(stored: PersistedMessage): void {
    const sessionId = this.context.taskSessions.get(stored.taskId)
    if (!sessionId) return
    const runtime = this.context.ensureRuntime(sessionId)
    if (!runtime) return
    this.context.appendLines(runtime, [
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
  saveToolInvocation(invocation: PersistedToolInvocation): void {
    const sessionId = this.context.taskSessions.get(invocation.taskId)
    if (!sessionId) return
    const runtime = this.context.ensureRuntime(sessionId)
    if (!runtime) return
    const turn = runtime.state.turns.find((candidate) => candidate.turnId === invocation.taskId)
    const existing = turn?.tools.get(invocation.id)
    this.context.appendLines(runtime, [
      {
        t: 'tool',
        ts: invocation.updatedAt,
        turnId: invocation.taskId,
        blockId: existing?.blockId ?? `tool-group:${invocation.taskId}`,
        callId: invocation.id,
        itemIndex: existing?.itemIndex ?? turn?.tools.size ?? 0,
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
}

function orderFor(
  turn: { blocks: Array<{ blockId: string; order: number }> } | undefined,
  blockId: string,
  fallback: number
): number {
  return turn?.blocks.find((block) => block.blockId === blockId)?.order ?? fallback
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
    const trailing = turn?.blocks.find((block) => block.kind === 'text' && block.order === order)
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
    const phase =
      payload.phase === 'process' || payload.phase === 'final' ? payload.phase : 'pending'
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
      status:
        payload.status === 'completed' || payload.status === 'cancelled'
          ? payload.status
          : 'failed',
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
      content: typeof payload.content === 'string' ? payload.content : undefined,
      ...(payload.error === undefined || payload.error === null ? {} : { error: payload.error })
    }
  }
  return { t: 'event', ts: event.occurredAt, turnId, type: event.type, payload: event.payload }
}
