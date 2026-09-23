import {
  STREAM_PROTOCOL,
  parseStreamServerEvent,
  type RequestCreateEvent,
  type StreamClientEvent,
  type StreamServerEvent,
  type ToolApprovalCommand
} from '@actiondriver/runtime-contracts'
import type {
  AgentGraphResult,
  GraphRunner,
  IdGenerator,
  ModelGatewayEvent,
  PersistedMessage,
  PersistedStreamRequest,
  RuntimeEventRecord,
  StreamSessionRepository,
  RuntimeTaskRecord
} from './ports'
import { ToolApprovalError, type ToolInvocationService } from './tool-invocation-service'
import {
  persistedToolActivity,
  toolActivityErrorSummary,
  toolActivityResultSummary
} from './tool-activity'

type Emit = (event: StreamServerEvent) => void | Promise<void>

type ActiveRequest = {
  controller: AbortController
  operation: Promise<void>
  delivery: { emit: Emit }
}

export class StreamSessionService {
  private readonly active = new Map<string, ActiveRequest>()
  private readonly activeSessions = new Set<string>()

  constructor(
    private readonly options: {
      repositories: StreamSessionRepository
      graphRunner: GraphRunner
      ids: IdGenerator
      now(): string
      approvals?: Pick<ToolInvocationService, 'approve' | 'reject'>
      rawToolIO?: { enabled: boolean; maxBytes?: number }
    }
  ) {}

  async close(): Promise<void> {
    const active = [...this.active.values()]
    for (const request of active) {
      request.controller.abort(new DOMException('Service shutting down', 'AbortError'))
    }
    await Promise.allSettled(active.map((request) => request.operation))
  }

  async handle(event: StreamClientEvent, emit: Emit): Promise<void> {
    if (event.type === 'request.create') {
      await this.create(event, emit)
      return
    }
    if (event.type === 'request.cancel') {
      const active = this.active.get(event.requestId)
      if (active) active.controller.abort(new DOMException('Request cancelled', 'AbortError'))
      return
    }
    if (event.type === 'request.resume') {
      await this.replay(event.requestId, event.afterCursor, emit)
      return
    }
    if (event.type === 'tool.approve' || event.type === 'tool.reject') {
      await this.decideTool(event, emit)
    }
  }

  private async decideTool(
    event: Extract<StreamClientEvent, { type: 'tool.approve' | 'tool.reject' }>,
    emit: Emit
  ): Promise<void> {
    const request = await this.options.repositories.streamRequests.getByRequestId(event.requestId)
    if (!request || request.taskId !== event.taskId) {
      await this.emitRequestError(
        event.requestId,
        'tool-approval-stale',
        'Tool request does not match this task',
        emit
      )
      return
    }
    if (!this.options.approvals) {
      await this.emitRequestError(
        event.requestId,
        'tool-approval-unavailable',
        'Tool approval is unavailable',
        emit
      )
      return
    }
    const command: ToolApprovalCommand = {
      action: event.type === 'tool.approve' ? 'approve' : 'reject',
      taskId: event.taskId,
      callId: event.callId,
      argumentsHash: event.argumentsHash
    }
    try {
      if (command.action === 'approve') await this.options.approvals.approve(command)
      else await this.options.approvals.reject(command)
    } catch (error) {
      const code =
        error instanceof ToolApprovalError
          ? error.code === 'TOOL_APPROVAL_STALE'
            ? 'tool-approval-stale'
            : 'tool-approval-not-pending'
          : 'tool-approval-failed'
      await this.emitRequestError(
        event.requestId,
        code,
        error instanceof Error ? error.message : String(error),
        emit
      )
    }
  }

  private async create(event: RequestCreateEvent, emit: Emit): Promise<void> {
    const existing = await this.options.repositories.streamRequests.getByIdempotencyKey(
      event.idempotencyKey
    )
    if (existing) {
      const acceptedRecord = await this.findEvent(existing.requestId, 'request.accepted')
      await emit(this.toServerEvent(existing, acceptedRecord))
      await this.replay(existing.requestId, acceptedRecord.cursor, emit)
      return
    }

    const previous = event.sessionId
      ? await this.options.repositories.tasks.getLatestBySession(event.sessionId)
      : null
    if (event.sessionId && !previous) {
      await this.emitRequestError(event.requestId, 'session-not-found', 'Unknown session', emit)
      return
    }
    if (
      previous &&
      (previous.status === 'running' || this.activeSessions.has(previous.sessionId))
    ) {
      await this.emitRequestError(
        event.requestId,
        'session-busy',
        'Another task is running in this session',
        emit
      )
      return
    }

    const now = this.options.now()
    const sessionId = previous?.sessionId ?? this.options.ids.next('session')
    const model = previous?.model ?? (event.sessionId === null ? event.payload.model : null)
    if (!model) {
      await this.emitRequestError(event.requestId, 'session-not-found', 'Unknown session', emit)
      return
    }
    const history = previous ? await this.sessionHistory(previous.sessionId) : []
    const userMessageId = this.options.ids.next('message')
    const assistantMessageId = this.options.ids.next('message')
    const request: PersistedStreamRequest = {
      requestId: event.requestId,
      idempotencyKey: event.idempotencyKey,
      sessionId,
      taskId: this.options.ids.next('task'),
      responseId: this.options.ids.next('response'),
      streamId: this.options.ids.next('stream'),
      messageId: assistantMessageId,
      status: 'running',
      lastSequence: -1,
      createdAt: now,
      updatedAt: now
    }
    const task: RuntimeTaskRecord = {
      id: request.taskId,
      threadId: request.taskId,
      sessionId: request.sessionId,
      goal: event.payload.input.content,
      model,
      status: 'running',
      error: null,
      lastCheckpointId: null,
      createdAt: now,
      updatedAt: now
    }
    const userMessage: PersistedMessage = {
      id: userMessageId,
      taskId: request.taskId,
      role: 'user',
      content: { text: event.payload.input.content },
      createdAt: now
    }
    const assistantMessage: PersistedMessage = {
      id: request.messageId,
      taskId: request.taskId,
      role: 'assistant',
      content: { text: '' },
      createdAt: now
    }
    const acceptedEvent = this.runtimeEvent(request, 'request.accepted', null, {})
    this.activeSessions.add(sessionId)
    let created
    try {
      created = await this.options.repositories.createStreamTask({
        request,
        task,
        userMessage,
        assistantMessage,
        acceptedEvent
      })
    } catch (error) {
      this.activeSessions.delete(sessionId)
      throw error
    }
    const storedRequest = created.request
    const acceptedRecord = await this.findEvent(storedRequest.requestId, 'request.accepted')
    await emit(this.toServerEvent(storedRequest, acceptedRecord))

    if (!created.created) {
      this.activeSessions.delete(sessionId)
      await this.replay(storedRequest.requestId, acceptedRecord.cursor, emit)
      return
    }

    const controller = new AbortController()
    const delivery = { emit }
    const operation = this.execute(
      event,
      storedRequest,
      task,
      assistantMessage,
      history,
      controller.signal,
      (event) => delivery.emit(event)
    ).finally(() => {
      if (this.active.get(storedRequest.requestId)?.operation === operation) {
        this.active.delete(storedRequest.requestId)
        this.activeSessions.delete(storedRequest.sessionId)
      }
    })
    this.active.set(storedRequest.requestId, { controller, operation, delivery })
    void operation.catch(() => undefined)
  }

  private async execute(
    createEvent: RequestCreateEvent,
    request: PersistedStreamRequest,
    initialTask: RuntimeTaskRecord,
    initialAssistant: PersistedMessage,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
    emit: Emit
  ): Promise<void> {
    let sequence = 0
    let activitySequence = 0
    let content = ''
    let terminal: Extract<ModelGatewayEvent, { kind: 'end' }> | null = null
    const startedAt = Date.parse(request.createdAt)
    const startRecord = await this.options.repositories.commitAssistantContentWithEvent(
      request,
      initialAssistant,
      this.runtimeEvent(request, 'response.start', sequence, { model: initialTask.model })
    )
    await emit(this.toServerEvent(request, startRecord))

    let result: AgentGraphResult | null = null
    let thrown: unknown = null
    try {
      result = await this.options.graphRunner.run(
        {
          taskId: request.taskId,
          goal: initialTask.goal,
          model: initialTask.model,
          messages: history,
          ...(createEvent.payload.systemPrompt === undefined
            ? {}
            : { systemPrompt: createEvent.payload.systemPrompt }),
          skills: [],
          streamRequestId: request.requestId
        },
        signal,
        async (event) => {
          if (event.kind === 'activity') {
            const activity = event.event
            const record = await this.options.repositories.events.append(
              this.runtimeEvent(
                request,
                `activity.${activity.type}`,
                null,
                activity,
                `activity.${activity.type}:${activity.activityId}:${activitySequence++}`
              )
            )
            await emit(this.toServerEvent(request, record))
            return
          }
          if (event.kind === 'end') {
            if (event.result?.kind !== 'tool-calls') terminal = event
            return
          }
          sequence += 1
          content += event.delta
          const record = await this.options.repositories.commitAssistantContentWithEvent(
            request,
            { ...initialAssistant, content: { text: content } },
            this.runtimeEvent(request, 'response.content', sequence, {
              delta: event.delta,
              contentIndex: 0
            })
          )
          await emit(this.toServerEvent(request, record))
        },
        async (record) => {
          if (record.requestId === request.requestId) {
            await emit(this.toServerEvent(request, record))
          }
        }
      )
    } catch (error) {
      thrown = error
    }

    const occurredAt = this.options.now()
    const cancelled = signal.aborted || result?.status === 'interrupted'
    const terminalEvent = terminal as Extract<ModelGatewayEvent, { kind: 'end' }> | null
    const completed = result?.status === 'completed' && terminalEvent !== null && !cancelled
    const status = completed ? 'completed' : cancelled ? 'cancelled' : 'failed'
    if (completed && terminalEvent) content = terminalEvent.content
    const error = completed
      ? null
      : cancelled
        ? { code: 'cancelled', message: 'Request was cancelled', retryable: false }
        : {
            code: 'model-execution-failed',
            message: result?.error ?? (thrown instanceof Error ? thrown.message : String(thrown)),
            retryable: false
          }
    sequence += 1
    const persistedRequest: PersistedStreamRequest = {
      ...request,
      status,
      lastSequence: sequence,
      updatedAt: occurredAt
    }
    const task: RuntimeTaskRecord = {
      ...initialTask,
      status,
      error,
      updatedAt: occurredAt
    }
    const endRecord = await this.options.repositories.finishStreamTask({
      request: persistedRequest,
      task,
      assistantMessage: { ...initialAssistant, content: { text: content } },
      event: this.runtimeEvent(request, 'response.end', sequence, {
        status,
        content,
        finishReason: completed && terminalEvent ? terminalEvent.finishReason : null,
        usage: completed && terminalEvent ? terminalEvent.usage : null,
        durationMs: Math.max(0, Date.parse(occurredAt) - startedAt),
        error
      })
    })
    await emit(this.toServerEvent(persistedRequest, endRecord))
  }

  private async replay(requestId: string, afterCursor: number, emit: Emit): Promise<void> {
    const active = this.active.get(requestId)
    if (active) active.delivery.emit = emit
    const request = await this.options.repositories.streamRequests.getByRequestId(requestId)
    if (!request) {
      await emit({
        type: 'request.error',
        protocol: STREAM_PROTOCOL,
        eventId: this.options.ids.next('event'),
        requestId,
        error: { code: 'request-not-found', message: 'Unknown request', retryable: false },
        occurredAt: this.options.now()
      })
      return
    }
    const retained = (await this.options.repositories.events.listAfter(0)).filter(
      (event) => event.requestId === requestId
    )
    const first = retained[0]
    const replayExpired =
      (!first && request.lastSequence >= 0) ||
      (first !== undefined && first.type !== 'request.accepted' && afterCursor < first.cursor - 1)
    if (replayExpired) {
      await emit(await this.snapshot(request, retained.at(-1)?.cursor ?? afterCursor))
      return
    }
    const events = retained.filter((event) => event.cursor > afterCursor)
    for (const event of events) await emit(this.toServerEvent(request, event))
  }

  private async snapshot(
    request: PersistedStreamRequest,
    cursor: number
  ): Promise<StreamServerEvent> {
    const [task, messages, toolInvocations, events] = await Promise.all([
      this.options.repositories.tasks.get(request.taskId),
      this.options.repositories.messages.listBySession(request.sessionId),
      this.options.repositories.toolInvocations?.listByTask(request.taskId) ?? Promise.resolve([]),
      this.options.repositories.events.listAfter(0)
    ])
    const activity = projectSnapshotActivity(
      events.filter((event) => event.requestId === request.requestId)
    )
    const error = toStreamError(task?.error)
    return parseStreamServerEvent({
      type: 'response.snapshot',
      protocol: STREAM_PROTOCOL,
      eventId: this.options.ids.next('event'),
      cursor,
      requestId: request.requestId,
      sessionId: request.sessionId,
      taskId: request.taskId,
      responseId: request.responseId,
      streamId: request.streamId,
      messageId: request.messageId,
      occurredAt: this.options.now(),
      sequence: request.lastSequence,
      status: request.status,
      messages: messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: messageText(message.content),
          createdAt: message.createdAt
        })),
      tools: toolInvocations.map((invocation) => ({
        callId: invocation.id,
        toolId: invocation.toolId,
        modelName: invocation.toolId,
        ...persistedToolActivity(invocation),
        argumentsHash: invocation.argumentsHash,
        status: invocation.status
      })),
      ...(activity.activities.length ? { activities: activity.activities } : {}),
      ...(activity.timeline.length ? { activityTimeline: activity.timeline } : {}),
      error
    })
  }

  private async findEvent(requestId: string, type: string): Promise<RuntimeEventRecord> {
    const event = (await this.options.repositories.events.listAfter(0)).find(
      (candidate) => candidate.requestId === requestId && candidate.type === type
    )
    if (!event) throw new Error(`Missing persisted ${type} event for ${requestId}`)
    return event
  }

  private async sessionHistory(
    sessionId: string
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const [tasks, messages] = await Promise.all([
      this.options.repositories.tasks.listBySession(sessionId),
      this.options.repositories.messages.listBySession(sessionId)
    ])
    const terminalTaskIds = new Set(
      tasks.filter((task) => task.status !== 'running').map((task) => task.id)
    )
    return messages.flatMap((message) => {
      if (!terminalTaskIds.has(message.taskId)) return []
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return [{ role: message.role, content: messageText(message.content) }]
    })
  }

  private async emitRequestError(
    requestId: string,
    code: string,
    message: string,
    emit: Emit
  ): Promise<void> {
    await emit(
      parseStreamServerEvent({
        type: 'request.error',
        protocol: STREAM_PROTOCOL,
        eventId: this.options.ids.next('event'),
        requestId,
        error: { code, message, retryable: false },
        occurredAt: this.options.now()
      })
    )
  }

  private runtimeEvent(
    request: PersistedStreamRequest,
    type: string,
    sequence: number | null,
    payload: unknown,
    eventKey?: string
  ): Omit<RuntimeEventRecord, 'cursor'> {
    return {
      taskId: request.taskId,
      threadId: request.sessionId,
      checkpointId: request.responseId,
      eventKey: eventKey ?? (sequence === null ? type : `${type}:${sequence}`),
      type,
      payload,
      occurredAt: this.options.now(),
      eventId: this.options.ids.next('event'),
      requestId: request.requestId,
      responseId: request.responseId,
      streamId: request.streamId,
      messageId: request.messageId,
      sequence
    }
  }

  private toServerEvent(
    request: PersistedStreamRequest,
    record: RuntimeEventRecord
  ): StreamServerEvent {
    const payload = record.payload as Record<string, unknown>
    const identity = {
      protocol: STREAM_PROTOCOL,
      eventId: record.eventId,
      cursor: record.cursor,
      requestId: request.requestId,
      sessionId: request.sessionId,
      taskId: request.taskId,
      responseId: request.responseId,
      streamId: request.streamId,
      messageId: request.messageId,
      occurredAt: record.occurredAt
    }
    if (record.type === 'request.accepted') {
      return parseStreamServerEvent({ type: record.type, ...identity })
    }
    if (record.type.startsWith('activity.')) {
      const activity = payload as {
        activityId: string | null
        title?: string
        titleRevision?: number
        delta?: string
        textId?: string
        phase?: 'process' | 'final'
      }
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        activityId: activity.activityId,
        ...(record.type === 'activity.started' || record.type === 'activity.updated'
          ? { title: activity.title, titleRevision: activity.titleRevision }
          : {}),
        ...(record.type === 'activity.text'
          ? { delta: activity.delta, ...(activity.textId ? { textId: activity.textId } : {}) }
          : {}),
        ...(record.type === 'activity.text.done'
          ? { textId: activity.textId, phase: activity.phase }
          : {})
      })
    }
    if (record.type.startsWith('tool.')) {
      const tool = payload as {
        callId: string
        toolId: string
        modelName: string
        summary: string
        argumentsHash: string
        activityId?: string | null
        input?: unknown
        stream?: string
        delta?: string
        output?: unknown
        error?: unknown
        durationMs?: unknown
      }
      const rawToolIO = this.options.rawToolIO?.enabled === true
      const maxRawBytes = this.options.rawToolIO?.maxBytes ?? 64 * 1024
      const rawInput = rawToolIO ? boundedJson(tool.input, maxRawBytes) : null
      const rawOutput =
        rawToolIO && record.type === 'tool.completed' ? boundedJson(tool.output, maxRawBytes) : null
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        callId: tool.callId,
        callSequence: record.sequence,
        toolId: tool.toolId,
        modelName: tool.modelName,
        summary: tool.summary,
        argumentsHash: tool.argumentsHash,
        activityId: tool.activityId ?? null,
        ...(rawInput ? { rawInput: rawInput.value, rawOutputTruncated: rawInput.truncated } : {}),
        ...(record.type === 'tool.content'
          ? {
              stream: tool.stream,
              delta: rawToolIO ? boundedText(tool.delta, maxRawBytes).value : '工具输出已接收'
            }
          : {}),
        ...(record.type === 'tool.completed'
          ? {
              durationMs: typeof tool.durationMs === 'number' ? tool.durationMs : 0,
              resultSummary: toolActivityResultSummary(tool.toolId, tool.output),
              ...(rawOutput
                ? { rawOutput: rawOutput.value, rawOutputTruncated: rawOutput.truncated }
                : {})
            }
          : {}),
        ...(record.type === 'tool.failed' || record.type === 'tool.cancelled'
          ? {
              error: {
                code: 'tool-failed',
                message: toolActivityErrorSummary(tool.error),
                retryable: false
              }
            }
          : {})
      })
    }
    return parseStreamServerEvent({
      type: record.type,
      ...identity,
      sequence: record.sequence,
      ...payload
    })
  }
}

function projectSnapshotActivity(events: RuntimeEventRecord[]) {
  const activities = new Map<
    string,
    { activityId: string; title: string; titleRevision: number; status: 'running' | 'completed'; items: Array<{ id: string; kind: 'text'; content: string } | { id: string; kind: 'tool'; callId: string }> }
  >()
  const timeline: Array<{ id: string; kind: 'activity'; activityId: string } | { id: string; kind: 'text'; content: string }> = []
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>
    if (event.type === 'activity.started' && typeof payload.activityId === 'string' && typeof payload.title === 'string') {
      activities.set(payload.activityId, { activityId: payload.activityId, title: payload.title, titleRevision: Number(payload.titleRevision) || 1, status: 'running', items: [] })
      timeline.push({ id: `activity:${payload.activityId}`, kind: 'activity', activityId: payload.activityId })
      continue
    }
    if (event.type === 'activity.updated' && typeof payload.activityId === 'string') {
      const activity = activities.get(payload.activityId)
      if (activity && typeof payload.title === 'string' && Number(payload.titleRevision) > activity.titleRevision) {
        activity.title = payload.title
        activity.titleRevision = Number(payload.titleRevision)
      }
      continue
    }
    if (event.type === 'activity.text' && typeof payload.activityId === 'string') {
      const activity = activities.get(payload.activityId)
      if (activity && typeof payload.delta === 'string') {
        activity.items.push({ id: String(event.eventId), kind: 'text', content: String(payload.delta) })
      }
      continue
    }
    if (event.type === 'activity.completed' && typeof payload.activityId === 'string') {
      const activity = activities.get(payload.activityId)
      if (activity) activity.status = 'completed'
    }
  }
  return { activities: [...activities.values()], timeline }
}

function boundedJson(value: unknown, maxBytes: number): { value: string; truncated: boolean } {
  return boundedText(JSON.stringify(value), maxBytes)
}

function boundedText(value: unknown, maxBytes: number): { value: string; truncated: boolean } {
  const text = typeof value === 'string' ? value : ''
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { value: text, truncated: false }
  let end = Math.min(text.length, maxBytes)
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1
  return { value: text.slice(0, end), truncated: true }
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object' && 'text' in content) {
    const text = (content as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

function toStreamError(value: unknown): {
  code: string
  message: string
  retryable: boolean
} | null {
  if (!value || typeof value !== 'object') return null
  const error = value as { code?: unknown; message?: unknown; retryable?: unknown }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return null
  return { code: error.code, message: error.message, retryable: error.retryable === true }
}
