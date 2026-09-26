import {
  STREAM_PROTOCOL,
  parseStreamServerEvent,
  type RequestCreateEvent,
  type StreamClientEvent,
  type StreamServerEvent
} from '@actiondriver/runtime-contracts'
import {
  emptyActivityTimelineState,
  reduceActivityProjection
} from '@actiondriver/activity-projection'
import {
  appendActivityAnchor,
  insertPartByOrder,
  nextPartOrder,
  normalizeAssistantParts,
  type ImageAssetRef,
  type MessageContentPart
} from '@actiondriver/contracts'
import type { ModelInputMessage } from '@actiondriver/model-connections'
import type { SessionAssetStore } from './media/session-asset-store'
import type { AppApprovalBroker, AppApprovalEvent } from './computer-use/app-approval-broker'
import type { BoundInputFile, SessionInputFileStore } from './media/session-input-file-store'
import type { OutputBaseline, SessionOutputStore } from './media/session-output-store'
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
import {
  persistedToolActivity,
  toolActivityErrorSummary,
  toolActivityResultSummary
} from './tool-activity'

/** Order reserved for one image inside its batch: the batch keeps `index` slots. */
function imageOrder(parts: readonly MessageContentPart[], callId: string, index: number): number {
  const batch = parts.find((part) => part.kind === 'image-batch' && part.callId === callId)
  return batch?.order === undefined ? nextPartOrder(parts) : batch.order + 1 + index
}

type Emit = (event: StreamServerEvent) => void | Promise<void>
type SnapshotEvent = Extract<StreamServerEvent, { type: 'response.snapshot' }>

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
  private readonly publicationTails = new Map<string, Promise<void>>()
  private readonly publishedCursors = new Map<string, number>()

  constructor(
    private readonly options: {
      repositories: StreamSessionRepository
      graphRunner: GraphRunner
      ids: IdGenerator
      now(): string
      rawToolIO?: { enabled: boolean; maxBytes?: number }
      appApprovals?: Pick<AppApprovalBroker, 'getPending' | 'cancelTask'>
      /**
       * Host cleanup for a finished turn (Computer Use: cancel pending app approvals, release app
       * leases). Runs once per turn, whatever its outcome, before its response.end is published.
       */
      turnEnded?: (taskId: string) => Promise<void>
      listEnabledSkills?: () => Promise<Array<{ skillId: string; description: string }>>
      assets?: Pick<SessionAssetStore, 'bindStaged'>
      inputFiles?: Pick<SessionInputFileStore, 'bind'>
      outputs?: Pick<SessionOutputStore, 'baseline' | 'detectChanges' | 'register'>
      listOutputs?: (taskId: string) => Promise<
        Array<{
          fileId: string
          sessionId: string
          taskId: string
          name: string
          mimeType: string
          byteLength: number
        }>
      >
      describeSessionInputs?: (
        sessionId: string
      ) => Promise<Array<{ name: string; path: string; mimeType: string }>>
    }
  ) {}

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
    const imageIds = event.payload.input.imageAssetIds ?? []
    if (imageIds.length > 0 && !this.options.assets) {
      await this.emitRequestError(
        event.requestId,
        'image-unavailable',
        'Image storage is unavailable',
        emit
      )
      return
    }
    let boundAssets: Awaited<ReturnType<SessionAssetStore['bindStaged']>>[] = []
    try {
      boundAssets = await Promise.all(
        imageIds.map((assetId) => this.options.assets!.bindStaged(assetId, sessionId))
      )
    } catch (error) {
      console.warn('[stream-session] image asset bind failed', error)
      await this.emitRequestError(
        event.requestId,
        'image-invalid',
        `Image cannot be attached (${attachmentErrorCode(error)})`,
        emit
      )
      return
    }
    const userParts: MessageContentPart[] = [
      ...(event.payload.input.content
        ? [{ kind: 'text' as const, text: event.payload.input.content }]
        : []),
      ...boundAssets.map((asset) => ({ kind: 'image' as const, asset }))
    ]
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
      goal: event.payload.input.content.trim() || '图片消息',
      model,
      status: 'running',
      error: null,
      lastCheckpointId: null,
      createdAt: now,
      updatedAt: now
    }
    const inputFileIds = event.payload.input.inputFileIds ?? []
    let boundInputs: BoundInputFile[] = []
    if (inputFileIds.length > 0) {
      if (!this.options.inputFiles) {
        await this.emitRequestError(
          event.requestId,
          'input-unavailable',
          'File storage is unavailable',
          emit
        )
        return
      }
      try {
        boundInputs = []
        for (const fileId of inputFileIds) {
          boundInputs.push(
            await this.options.inputFiles.bind(fileId, {
              sessionId,
              taskId: request.taskId
            })
          )
        }
      } catch (error) {
        console.warn('[stream-session] input file bind failed', error)
        await this.emitRequestError(
          event.requestId,
          'input-invalid',
          `File cannot be attached (${attachmentErrorCode(error)})`,
          emit
        )
        return
      }
      // Images keep their existing thumbnail part; only documents need a card.
      userParts.push(
        ...boundInputs
          .filter((file) => !file.mimeType.startsWith('image/'))
          .map((file) => ({
            kind: 'document' as const,
            file: {
              fileId: file.fileId,
              sessionId: file.sessionId,
              taskId: file.taskId,
              name: file.name,
              mimeType: file.mimeType,
              byteLength: file.byteLength
            }
          }))
      )
      if (!task.goal.trim() || task.goal === '图片消息') task.goal = boundInputs[0]!.name
    }
    const userMessage: PersistedMessage = {
      id: userMessageId,
      taskId: request.taskId,
      role: 'user',
      content: { parts: userParts },
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
    this.publishedCursors.set(storedRequest.requestId, acceptedRecord.cursor)

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
      boundAssets.length > 0 ? { role: 'user', content: userParts } : undefined,
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
        this.publicationTails.delete(storedRequest.requestId)
        this.publishedCursors.delete(storedRequest.requestId)
      }
    })
    this.active.set(storedRequest.requestId, {
      sessionId: storedRequest.sessionId,
      taskId: storedRequest.taskId,
      controller,
      operation,
      delivery
    })
    void operation.catch(() => undefined)
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

  private async execute(
    createEvent: RequestCreateEvent,
    request: PersistedStreamRequest,
    initialTask: RuntimeTaskRecord,
    initialAssistant: PersistedMessage,
    history: ModelInputMessage[],
    currentMessage: ModelInputMessage | undefined,
    signal: AbortSignal,
    emit: Emit
  ): Promise<void> {
    let sequence = 0
    let activitySequence = 0
    let content = ''
    const assistantParts: MessageContentPart[] = []
    const seenImages = new Set<string>()
    const assistantContent = () =>
      assistantParts.some(
        (part) => part.kind === 'image' || part.kind === 'image-batch' || part.kind === 'activity'
      )
        ? { parts: normalizeAssistantParts(assistantParts) }
        : { text: content }
    let terminal: Extract<ModelGatewayEvent, { kind: 'end' }> | null = null
    const startedAt = Date.parse(request.createdAt)
    const startRecord = await this.options.repositories.commitAssistantContentWithEvent(
      request,
      initialAssistant,
      this.runtimeEvent(request, 'response.start', sequence, { model: initialTask.model })
    )
    await this.publishThrough(request, startRecord.cursor, emit)

    let result: AgentGraphResult | null = null
    let thrown: unknown = null
    let outputBaseline: OutputBaseline | null = null
    try {
      outputBaseline = (await this.options.outputs?.baseline(request.sessionId)) ?? null
      const sessionInputs = (await this.options.describeSessionInputs?.(request.sessionId)) ?? []
      result = await this.options.graphRunner.run(
        {
          taskId: request.taskId,
          sessionId: request.sessionId,
          goal: initialTask.goal,
          model: initialTask.model,
          messages: history,
          ...(sessionInputs.length > 0
            ? {
                inputContext: sessionInputs
              }
            : {}),
          ...(currentMessage ? { currentMessage } : {}),
          ...(createEvent.payload.systemPrompt === undefined
            ? {}
            : { systemPrompt: createEvent.payload.systemPrompt }),
          skills: (await this.options.listEnabledSkills?.()) ?? [],
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
            await this.publishThrough(request, record.cursor, emit)
            return
          }
          if (event.kind === 'tool-call-preparing') {
            const record = await this.options.repositories.events.append(
              this.runtimeEvent(
                request,
                'response.tool_preparing',
                null,
                { index: event.index, modelName: event.modelName },
                `response.tool_preparing:${activitySequence++}`
              )
            )
            await this.publishThrough(request, record.cursor, emit)
            return
          }
          if (event.kind === 'end') {
            if (event.result?.kind !== 'tool-calls') terminal = event
            return
          }
          sequence += 1
          content += event.delta
          const last = assistantParts.at(-1)
          const continuesText = last?.kind === 'text'
          const textOrder = continuesText ? (last.order ?? 0) : nextPartOrder(assistantParts)
          if (last?.kind === 'text') last.text += event.delta
          else assistantParts.push({ kind: 'text', text: event.delta, order: textOrder })
          const contentIndex = assistantParts.indexOf(assistantParts.at(-1)!)
          const record = await this.options.repositories.commitAssistantContentWithEvent(
            request,
            { ...initialAssistant, content: assistantContent() },
            this.runtimeEvent(request, 'response.content', sequence, {
              delta: event.delta,
              contentIndex,
              order: textOrder
            })
          )
          await this.publishThrough(request, record.cursor, emit)
        },
        async (record) => {
          if (record.requestId === request.requestId) {
            if (record.type.startsWith('tool.')) {
              // Anchor the tool group where it starts, so the transcript keeps
              // the model's own order: prose, tools, images, prose.
              const activityId = (record.payload as { activityId?: unknown }).activityId
              if (typeof activityId === 'string') appendActivityAnchor(assistantParts, activityId)
            }
            if (record.type === 'tool.running') {
              const payload = record.payload as {
                callId?: unknown
                toolId?: unknown
                imageCount?: unknown
              }
              if (
                payload.toolId === 'image.generate' &&
                typeof payload.callId === 'string' &&
                typeof payload.imageCount === 'number' &&
                Number.isInteger(payload.imageCount) &&
                payload.imageCount >= 1 &&
                payload.imageCount <= 16 &&
                !assistantParts.some(
                  (part) => part.kind === 'image-batch' && part.callId === payload.callId
                )
              ) {
                const contentIndex = assistantParts.length
                const batchOrder = nextPartOrder(assistantParts)
                assistantParts.push({
                  kind: 'image-batch',
                  callId: payload.callId,
                  imageCount: payload.imageCount,
                  order: batchOrder
                })
                sequence += 1
                let batchRecord
                try {
                  batchRecord = await this.options.repositories.commitAssistantContentWithEvent(
                    request,
                    { ...initialAssistant, content: assistantContent() },
                    this.runtimeEvent(
                      request,
                      'response.image_batch',
                      sequence,
                      {
                        callId: payload.callId,
                        imageCount: payload.imageCount,
                        contentIndex,
                        order: batchOrder
                      },
                      `response.image_batch:${payload.callId}`
                    )
                  )
                } catch (error) {
                  assistantParts.pop()
                  sequence -= 1
                  throw error
                }
                await this.publishThrough(request, batchRecord.cursor, emit)
                return
              }
            }
            await this.publishThrough(request, record.cursor, emit)
            if (record.type === 'tool.asset') {
              const payload = record.payload as {
                callId?: unknown
                index?: unknown
                asset?: unknown
              }
              if (
                typeof payload.callId !== 'string' ||
                typeof payload.index !== 'number' ||
                !isImageAssetRef(payload.asset) ||
                payload.asset.sessionId !== request.sessionId
              )
                return
              const asset = payload.asset
              const callId = payload.callId
              const imageIndex = payload.index
              const imageKey = `${callId}:${imageIndex}`
              if (seenImages.has(imageKey)) return
              if (assistantParts.length === 0 && content)
                assistantParts.push({
                  kind: 'text',
                  text: content,
                  order: nextPartOrder(assistantParts)
                })
              // The batch reserved a slot per image, so the picture lands where
              // it was planned even when a later slot finishes first.
              const order = imageOrder(assistantParts, callId, imageIndex)
              insertPartByOrder(assistantParts, {
                kind: 'image',
                asset,
                generation: { callId, index: imageIndex },
                order
              })
              const contentIndex = assistantParts.findIndex(
                (part) => part.kind === 'image' && part.asset.assetId === asset.assetId
              )
              sequence += 1
              let imageRecord
              try {
                imageRecord = await this.options.repositories.commitAssistantImageWithEvent(
                  request,
                  { ...initialAssistant, content: assistantContent() },
                  this.runtimeEvent(
                    request,
                    'response.image',
                    sequence,
                    {
                      asset,
                      contentIndex,
                      callId,
                      index: imageIndex,
                      order
                    },
                    `response.image:${imageKey}`
                  )
                )
              } catch (error) {
                const inserted = assistantParts.findIndex(
                  (part) => part.kind === 'image' && part.asset.assetId === asset.assetId
                )
                if (inserted >= 0) assistantParts.splice(inserted, 1)
                sequence -= 1
                throw error
              }
              seenImages.add(imageKey)
              await this.publishThrough(request, imageRecord.cursor, emit)
            }
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
    if (completed && terminalEvent) {
      content = terminalEvent.content
      // The streamed part order is canonical: text stays where it appeared
      // relative to the visual batches. Only text the model sent without
      // streaming it (terminal answer with no content events) is appended, so
      // live rendering and the stored transcript never disagree.
      const hasVisuals = assistantParts.some(
        (part) => part.kind === 'image' || part.kind === 'image-batch'
      )
      if (hasVisuals && content) {
        const streamedText = assistantParts
          .filter((part) => part.kind === 'text')
          .map((part) => part.text)
          .join('')
        // Only append an answer the model never streamed; anything already in
        // the transcript (in its streamed position) stays untouched.
        if (!streamedText || (!streamedText.endsWith(content) && !content.endsWith(streamedText))) {
          assistantParts.push({
            kind: 'text',
            text: content,
            order: nextPartOrder(assistantParts)
          })
        }
      }
    }
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
    let registeredOutputs: Array<{
      fileId: string
      sessionId: string
      taskId: string
      name: string
      mimeType: string
      byteLength: number
    }> = []
    if (completed && outputBaseline && this.options.outputs) {
      const changes = await this.options.outputs.detectChanges(request.sessionId, outputBaseline)
      if (changes.length > 0) {
        registeredOutputs = await this.options.outputs.register({
          sessionId: request.sessionId,
          taskId: request.taskId,
          files: changes
        })
      }
    }
    await this.options.appApprovals?.cancelTask(request.taskId)
    try {
      await this.options.turnEnded?.(request.taskId)
    } catch (error) {
      // Cleanup must not keep the turn from ending; its failure is only reported.
      console.warn('[stream-session] turn cleanup failed', error)
    }
    const endRecord = await this.options.repositories.finishStreamTask({
      request: persistedRequest,
      task,
      assistantMessage: { ...initialAssistant, content: assistantContent() },
      event: this.runtimeEvent(request, 'response.end', sequence, {
        status,
        content,
        finishReason: completed && terminalEvent ? terminalEvent.finishReason : null,
        usage: completed && terminalEvent ? terminalEvent.usage : null,
        durationMs: Math.max(0, Date.parse(occurredAt) - startedAt),
        ...(registeredOutputs.length > 0
          ? {
              outputFiles: registeredOutputs.map((file) => ({
                fileId: file.fileId,
                sessionId: file.sessionId,
                taskId: file.taskId,
                name: file.name,
                mimeType: file.mimeType,
                byteLength: file.byteLength
              }))
            }
          : {}),
        error
      })
    })
    this.activeSessions.delete(request.sessionId)
    await this.publishThrough(persistedRequest, endRecord.cursor, emit)
  }

  private async publishThrough(
    request: PersistedStreamRequest,
    cursor: number,
    emit: Emit
  ): Promise<void> {
    const previous = this.publicationTails.get(request.requestId) ?? Promise.resolve()
    const current = previous.then(async () => {
      let last = this.publishedCursors.get(request.requestId) ?? 0
      while (last < cursor) {
        const records = await this.options.repositories.events.listForRequestAfter(
          request.requestId,
          last,
          256
        )
        if (records.length === 0) break
        for (const record of records) {
          if (record.cursor > cursor) return
          await emit(this.toServerEvent(request, record))
          last = record.cursor
          this.publishedCursors.set(request.requestId, last)
        }
      }
    })
    this.publicationTails.set(
      request.requestId,
      current.catch(() => undefined)
    )
    await current
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
    if (this.options.appApprovals) {
      // Approval waiters are process-local. Restore their live state together with the
      // authoritative task projection rather than briefly displaying historical requests.
      await emit(await this.snapshot(requestId))
      return
    }
    const first = (await this.options.repositories.events.listForRequestAfter(requestId, 0, 1))[0]
    const replayExpired =
      (!first && request.lastSequence >= 0) ||
      (first !== undefined && first.type !== 'request.accepted' && afterCursor < first.cursor)
    if (replayExpired) {
      await emit(await this.snapshot(request.requestId))
      return
    }
    let cursor = afterCursor
    while (true) {
      const events = await this.options.repositories.events.listForRequestAfter(
        requestId,
        cursor,
        256
      )
      if (events.length === 0) break
      for (const event of events) {
        await emit(this.toServerEvent(request, event))
        cursor = event.cursor
      }
    }
  }

  private async snapshot(requestId: string): Promise<SnapshotEvent> {
    const {
      request,
      cursor,
      task,
      messages,
      tools: toolInvocations,
      events
    } = await this.options.repositories.readStreamSnapshot(requestId)
    const activity = events
      .map((event) => this.toServerEvent(request, event))
      .reduce(reduceActivityProjection, emptyActivityTimelineState())
    const error = toStreamError(task?.error)
    const end = [...events].reverse().find((event) => event.type === 'response.end')
    const durationMs = (end?.payload as { durationMs?: unknown } | undefined)?.durationMs
    let preparingToolName: string | null = null
    if (request.status === 'running') {
      for (const event of events) {
        if (event.type === 'response.tool_preparing') {
          const modelName = (event.payload as { modelName?: unknown }).modelName
          preparingToolName = typeof modelName === 'string' ? modelName : null
        } else if (
          event.type === 'response.content' ||
          event.type === 'activity.text' ||
          event.type.startsWith('tool.')
        ) {
          preparingToolName = null
        }
      }
    }
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
      pendingAppApproval:
        request.status === 'running' && this.active.has(request.requestId)
          ? [...(this.options.appApprovals?.getPending(request.taskId) ?? [])]
          : [],
      ...(await this.outputFilesFor(request.taskId)),
      messages: messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: messageText(message.content),
          ...(messageParts(message.content)
            ? {
                parts:
                  message.role === 'assistant'
                    ? normalizeAssistantParts(messageParts(message.content)!)
                    : messageParts(message.content)!
              }
            : {}),
          createdAt: message.createdAt
        })),
      tools: toolInvocations.map((invocation) => {
        const persisted = persistedToolActivity(invocation)
        const activityId = activity.toolActivityIds[invocation.id] ?? null
        const rawToolIO = this.options.rawToolIO?.enabled === true
        const maxRawBytes = this.options.rawToolIO?.maxBytes ?? 64 * 1024
        const rawInput = rawToolIO ? boundedJson(invocation.input, maxRawBytes) : null
        const rawOutput = rawToolIO ? boundedJson(invocation.output, maxRawBytes) : null
        return {
          callId: invocation.id,
          toolId: invocation.toolId,
          modelName: invocation.toolId,
          ...persisted,
          argumentsHash: invocation.argumentsHash,
          ...(invocation.toolId === 'image.generate' &&
          Array.isArray((invocation.input as { images?: unknown }).images) &&
          (invocation.input as { images: unknown[] }).images.length >= 1 &&
          (invocation.input as { images: unknown[] }).images.length <= 16
            ? { imageCount: (invocation.input as { images: unknown[] }).images.length }
            : {}),
          status: invocation.status,
          activityId,
          ...(rawInput ? { rawInput: rawInput.value } : {}),
          ...(rawOutput ? { rawOutput: rawOutput.value } : {}),
          ...(rawInput?.truncated || rawOutput?.truncated ? { rawOutputTruncated: true } : {})
        }
      }),
      ...(activity.activities.length ? { activities: activity.activities } : {}),
      ...(activity.timeline.length ? { activityTimeline: activity.timeline } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(preparingToolName ? { preparingToolName } : {}),
      error
    }) as SnapshotEvent
  }

  private async outputFilesFor(taskId: string): Promise<{
    outputFiles?: Array<{
      fileId: string
      sessionId: string
      taskId: string
      name: string
      mimeType: string
      byteLength: number
    }>
  }> {
    const files = (await this.options.listOutputs?.(taskId)) ?? []
    if (files.length === 0) return {}
    return {
      outputFiles: files.map((file) => ({
        fileId: file.fileId,
        sessionId: file.sessionId,
        taskId: file.taskId,
        name: file.name,
        mimeType: file.mimeType,
        byteLength: file.byteLength
      }))
    }
  }

  private async findEvent(requestId: string, type: string): Promise<RuntimeEventRecord> {
    const event = (
      await this.options.repositories.events.listForRequestAfter(requestId, 0, 1)
    ).find((candidate) => candidate.type === type)
    if (!event) throw new Error(`Missing persisted ${type} event for ${requestId}`)
    return event
  }

  private async sessionHistory(sessionId: string): Promise<ModelInputMessage[]> {
    const [tasks, messages] = await Promise.all([
      this.options.repositories.tasks.listBySession(sessionId),
      this.options.repositories.messages.listBySession(sessionId)
    ])
    const terminalTaskIds = new Set(
      tasks.filter((task) => task.status !== 'running').map((task) => task.id)
    )
    return messages.flatMap<ModelInputMessage>((message): ModelInputMessage[] => {
      if (!terminalTaskIds.has(message.taskId)) return []
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return message.role === 'user'
        ? [{ role: 'user' as const, content: messageText(message.content) }]
        : [{ role: 'assistant' as const, content: messageText(message.content) }]
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
  const parts = messageParts(content)
  if (parts)
    return parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('')
  if (content && typeof content === 'object' && 'text' in content) {
    const text = (content as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  return ''
}

function messageParts(content: unknown): MessageContentPart[] | null {
  if (
    !content ||
    typeof content !== 'object' ||
    !('parts' in content) ||
    !Array.isArray(content.parts)
  )
    return null
  return content.parts as MessageContentPart[]
}

function isImageAssetRef(value: unknown): value is ImageAssetRef {
  if (!value || typeof value !== 'object') return false
  const asset = value as Partial<ImageAssetRef>
  return (
    typeof asset.assetId === 'string' &&
    typeof asset.sessionId === 'string' &&
    (asset.mimeType === 'image/png' ||
      asset.mimeType === 'image/jpeg' ||
      asset.mimeType === 'image/webp') &&
    typeof asset.width === 'number' &&
    typeof asset.height === 'number' &&
    typeof asset.byteLength === 'number' &&
    asset.source === 'generated'
  )
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

/** The store error code (for example `INPUT_FILE_NOT_FOUND`), so a failed attachment is diagnosable. */
function attachmentErrorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'UNKNOWN'
}
