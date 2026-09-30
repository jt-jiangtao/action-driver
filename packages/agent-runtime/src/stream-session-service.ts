import { projectToolDetails, toolPresentationSchema } from '@action-driver/plugin-contracts'
import {
  STREAM_PROTOCOL,
  parseStreamServerEvent,
  type RequestCreateEvent,
  type StreamClientEvent,
  type StreamServerEvent
} from '@action-driver/runtime-contracts'
import type { AppApprovalEvent } from './host-ports'
import type { PersistedStreamRequest, RuntimeEventRecord } from './ports'
import { toolActivityErrorSummary, toolActivityResultSummary } from './tool-activity'
import { StreamEventDelivery, type Emit } from './stream/event-delivery'
import type { StreamSessionOptions } from './stream/session-context'
import { createStreamRequest } from './stream/request-creation'
import { executeTurn } from './stream/turn-execution'
import { buildStreamSnapshot, type SnapshotEvent } from './stream/stream-snapshot'
import { boundedJson, boundedText } from './stream/stream-values'

type ActiveRequest = {
  sessionId: string
  taskId: string
  controller: AbortController
  operation: Promise<void>
  delivery: { emit: Emit }
}

export class StreamSessionService {
  private readonly active = new Map<string, ActiveRequest>()
  private readonly activeSessions = new Set<string>()
  private readonly delivery: StreamEventDelivery

  constructor(private readonly options: StreamSessionOptions) {
    this.delivery = new StreamEventDelivery({
      repositories: this.options.repositories,
      toServerEvent: (request, record) => this.toServerEvent(request, record),
      requestNotFoundEvent: (requestId) => ({
        type: 'request.error',
        protocol: STREAM_PROTOCOL,
        eventId: this.options.ids.next('event'),
        requestId,
        error: { code: 'request-not-found', message: 'Unknown request', retryable: false },
        occurredAt: this.options.now()
      }),
      hasPendingApprovals: this.options.appApprovals !== undefined,
      snapshot: (requestId) => this.snapshot(requestId),
      rebindLiveDelivery: (requestId, emit) => {
        const active = this.active.get(requestId)
        if (active) active.delivery.emit = emit
      }
    })
  }

  async close(): Promise<void> {
    const active = [...this.active.values()]
    for (const request of active) {
      request.controller.abort(new DOMException('Service shutting down', 'AbortError'))
    }
    await Promise.all(
      [...this.active.keys()].map(async (requestId) => {
        const request = await this.options.repositories.streamRequests.getByRequestId(requestId)
        if (request) await this.options.appApprovals?.cancelTask(request.taskId)
      })
    )
    await Promise.allSettled(active.map((request) => request.operation))
  }

  async getTaskSnapshot(taskId: string): Promise<SnapshotEvent | null> {
    const request = await this.options.repositories.streamRequests.getByTaskId(taskId)
    return request ? await this.snapshot(request.requestId) : null
  }

  async publishAppApproval(event: AppApprovalEvent): Promise<void> {
    const request = await this.options.repositories.streamRequests.getByTaskId(event.request.taskId)
    const active = request && this.active.get(request.requestId)
    if (
      !request ||
      !active ||
      request.status !== 'running' ||
      request.sessionId !== event.request.sessionId
    ) {
      throw new Error('CANCELLED: application approval task is no longer active')
    }
    const record = await this.options.repositories.events.append(
      this.runtimeEvent(
        request,
        event.type,
        null,
        {
          approval: event.request,
          ...(event.type === 'computer.app-approval.resolved' ? { decision: event.decision } : {})
        },
        `${event.type}:${event.request.requestId}`
      )
    )
    await this.publishThrough(request, record.cursor, active.delivery.emit)
  }

  async handle(event: StreamClientEvent, emit: Emit): Promise<void> {
    if (event.type === 'request.create') {
      await this.create(event, emit)
      return
    }
    if (event.type === 'request.cancel') {
      await this.cancelRequest(event.requestId, 'Request cancelled')
      return
    }
    if (event.type === 'request.resume') {
      await this.replay(event.requestId, event.afterCursor, emit)
      return
    }
  }

  private async create(event: RequestCreateEvent, emit: Emit): Promise<void> {
    const prepared = await createStreamRequest(
      {
        options: this.options,
        isSessionActive: (sessionId) => this.activeSessions.has(sessionId),
        reserveSession: (sessionId) => this.activeSessions.add(sessionId),
        releaseSession: (sessionId) => this.activeSessions.delete(sessionId),
        runtimeEvent: (request, type, sequence, payload, eventKey) =>
          this.runtimeEvent(request, type, sequence, payload, eventKey)
      },
      event
    )
    if (prepared.kind === 'rejected') {
      await this.emitRequestError(event.requestId, prepared.code, prepared.message, emit)
      return
    }
    if (prepared.kind === 'existing') {
      const acceptedRecord = await this.findEvent(prepared.request.requestId, 'request.accepted')
      await emit(this.toServerEvent(prepared.request, acceptedRecord))
      await this.replay(prepared.request.requestId, acceptedRecord.cursor, emit)
      return
    }

    const storedRequest = prepared.request
    const acceptedRecord = await this.findEvent(storedRequest.requestId, 'request.accepted')
    await emit(this.toServerEvent(storedRequest, acceptedRecord))
    this.delivery.markPublished(storedRequest.requestId, acceptedRecord.cursor)

    if (!prepared.persisted) {
      this.activeSessions.delete(storedRequest.sessionId)
      await this.replay(storedRequest.requestId, acceptedRecord.cursor, emit)
      return
    }

    const controller = new AbortController()
    const delivery = { emit }
    const operation = executeTurn(
      {
        options: this.options,
        runtimeEvent: (request, type, sequence, payload, eventKey) =>
          this.runtimeEvent(request, type, sequence, payload, eventKey),
        publishThrough: (request, cursor, sink) => this.publishThrough(request, cursor, sink),
        releaseSession: (sessionId) => this.activeSessions.delete(sessionId)
      },
      event,
      storedRequest,
      prepared.task,
      prepared.assistantMessage,
      prepared.history,
      prepared.currentMessage,
      controller.signal,
      (event) => delivery.emit(event)
    ).finally(() => {
      if (this.active.get(storedRequest.requestId)?.operation === operation) {
        this.active.delete(storedRequest.requestId)
        if (
          ![...this.active.values()].some((active) => active.sessionId === storedRequest.sessionId)
        ) {
          this.activeSessions.delete(storedRequest.sessionId)
        }
        this.delivery.release(storedRequest.requestId)
      }
    })
    this.active.set(storedRequest.requestId, {
      sessionId: storedRequest.sessionId,
      taskId: storedRequest.taskId,
      controller,
      operation,
      delivery
    })
    void operation.catch((error: unknown) => {
      console.error('[stream-session] turn failed', error)
    })
  }

  /**
   * Aborts the running request of one task and drops its pending Computer Use approvals. The user
   * stopping Computer Use with Esc takes this path (2.11), so it is the same as `request.cancel`.
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const running = [...this.active.entries()].find(([, request]) => request.taskId === taskId)
    if (!running) return false
    await this.cancelRequest(running[0], 'Computer Use stopped by the user')
    return true
  }

  private async cancelRequest(requestId: string, reason: string): Promise<void> {
    const active = this.active.get(requestId)
    if (!active) return
    active.controller.abort(new DOMException(reason, 'AbortError'))
    const request = await this.options.repositories.streamRequests.getByRequestId(requestId)
    if (request) await this.options.appApprovals?.cancelTask(request.taskId)
  }

  private async publishThrough(
    request: PersistedStreamRequest,
    cursor: number,
    emit: Emit
  ): Promise<void> {
    await this.delivery.publishThrough(request, cursor, emit)
  }

  private async replay(requestId: string, afterCursor: number, emit: Emit): Promise<void> {
    await this.delivery.replay(requestId, afterCursor, emit)
  }

  private async snapshot(requestId: string): Promise<SnapshotEvent> {
    return await buildStreamSnapshot(
      {
        repositories: this.options.repositories,
        toServerEvent: (request, record) => this.toServerEvent(request, record),
        nextEventId: () => this.options.ids.next('event'),
        now: () => this.options.now(),
        ...(this.options.rawToolIO ? { rawToolIO: this.options.rawToolIO } : {}),
        ...(this.options.toolPresentation
          ? { toolPresentation: this.options.toolPresentation }
          : {}),
        isActive: (candidate) => this.active.has(candidate),
        pendingAppApprovals: (taskId) => this.options.appApprovals?.getPending(taskId),
        ...(this.options.listOutputs ? { listOutputs: this.options.listOutputs } : {})
      },
      requestId
    )
  }

  private async findEvent(requestId: string, type: string): Promise<RuntimeEventRecord> {
    const event =
      // The acceptance record is not guaranteed to be the very first record of the request once
      // the turn itself is persisted, so scan the request's persisted events instead of the head.
      (await this.options.repositories.events.listForRequestAfter(requestId, 0, 256)).find(
        (candidate) => candidate.type === type
      )
    if (!event) throw new Error(`Missing persisted ${type} event for ${requestId}`)
    return event
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
      occurredAt: record.occurredAt,
      sequence: record.sequence
    }
    if (record.type === 'request.accepted') {
      return parseStreamServerEvent({ type: record.type, ...identity })
    }
    if (
      record.type === 'computer.app-approval.requested' ||
      record.type === 'computer.app-approval.resolved'
    ) {
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        approval: payload.approval,
        ...(record.type === 'computer.app-approval.resolved' ? { decision: payload.decision } : {})
      })
    }
    if (record.type === 'runtime.interrupted') {
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        error: payload.error
      })
    }
    if (record.type === 'response.tool_preparing') {
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        index: payload.index,
        modelName: payload.modelName
      })
    }
    if (record.type === 'response.image') {
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        asset: payload.asset,
        contentIndex: payload.contentIndex,
        callId: payload.callId,
        index: payload.index,
        ...(typeof payload.order === 'number' ? { order: payload.order } : {})
      })
    }
    if (record.type === 'response.image_batch') {
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        callId: payload.callId,
        imageCount: payload.imageCount,
        contentIndex: payload.contentIndex,
        ...(typeof payload.order === 'number' ? { order: payload.order } : {})
      })
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
        imageCount?: unknown
        title?: string
        argumentsHash: string
        activityId?: string | null
        input?: unknown
        presentation?: unknown
        stream?: string
        delta?: string
        output?: unknown
        asset?: unknown
        index?: unknown
        error?: unknown
        durationMs?: unknown
        sequence?: number
        callSequence?: number
      }
      const rawToolIO = this.options.rawToolIO?.enabled === true
      const maxRawBytes = this.options.rawToolIO?.maxBytes ?? 64 * 1024
      const presentation = Object.hasOwn(tool, 'presentation')
        ? toolPresentationSchema.safeParse(tool.presentation).data
        : this.options.toolPresentation?.(tool.toolId)
      const details = projectToolDetails(
        presentation,
        tool.input,
        record.type === 'tool.asset' ? { assets: [tool.asset] } : tool.output,
        { maxBytes: maxRawBytes }
      )
      const rawInput = rawToolIO ? boundedJson(tool.input, maxRawBytes) : null
      const rawOutput =
        rawToolIO && record.type === 'tool.completed' ? boundedJson(tool.output, maxRawBytes) : null
      return parseStreamServerEvent({
        type: record.type,
        ...identity,
        callId: tool.callId,
        callSequence:
          typeof tool.callSequence === 'number'
            ? tool.callSequence
            : typeof tool.sequence === 'number'
              ? tool.sequence
              : (record.sequence ?? 0),
        toolId: tool.toolId,
        modelName: tool.modelName,
        summary: tool.summary,
        ...(typeof tool.imageCount === 'number' ? { imageCount: tool.imageCount } : {}),
        ...(tool.title ? { title: tool.title } : {}),
        argumentsHash: tool.argumentsHash,
        activityId: tool.activityId ?? null,
        ...(rawToolIO ? { details, ...(presentation ? { presentation } : {}) } : {}),
        ...(rawInput ? { rawInput: rawInput.value, rawOutputTruncated: rawInput.truncated } : {}),
        ...(record.type === 'tool.content'
          ? {
              stream: tool.stream,
              delta: rawToolIO ? boundedText(tool.delta, maxRawBytes).value : '工具输出已接收'
            }
          : {}),
        ...(record.type === 'tool.asset' ? { asset: tool.asset, index: tool.index } : {}),
        ...(record.type === 'tool.completed'
          ? {
              durationMs: typeof tool.durationMs === 'number' ? tool.durationMs : 0,
              resultSummary: toolActivityResultSummary(tool.toolId, tool.output),
              ...(rawOutput
                ? { rawOutput: rawOutput.value, rawOutputTruncated: rawOutput.truncated }
                : {})
            }
          : {}),
        ...(record.type === 'tool.failed' ||
        record.type === 'tool.cancelled' ||
        record.type === 'tool.unknown'
          ? {
              error:
                tool.error && typeof tool.error === 'object' && 'code' in tool.error
                  ? tool.error
                  : {
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
