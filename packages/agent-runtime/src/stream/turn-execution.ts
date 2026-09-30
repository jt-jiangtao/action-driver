import { legacyResourceUri, type RequestCreateEvent } from '@action-driver/runtime-contracts'
import {
  appendActivityAnchor,
  insertPartByOrder,
  isImageGenerationToolId,
  nextPartOrder,
  normalizeAssistantParts,
  type MessageContentPart
} from '@action-driver/contracts'
import type { ModelInputMessage } from '@action-driver/model-connections'
import type { OutputBaseline } from '../host-ports'
import type {
  AgentGraphResult,
  ModelGatewayEvent,
  PersistedMessage,
  PersistedStreamRequest,
  RuntimeTaskRecord
} from '../ports'
import type { Emit } from './event-delivery'
import { imageOrder, isImageAssetRef } from './stream-values'
import type { StreamEventFactory, StreamPublish, StreamSessionOptions } from './session-context'

export type TurnExecutionDependencies = {
  options: StreamSessionOptions
  runtimeEvent: StreamEventFactory
  publishThrough: StreamPublish
  releaseSession(sessionId: string): void
}

export async function executeTurn(
  dependencies: TurnExecutionDependencies,
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
  const startRecord = await dependencies.options.repositories.commitAssistantContentWithEvent(
    request,
    initialAssistant,
    dependencies.runtimeEvent(request, 'response.start', sequence, { model: initialTask.model })
  )
  await dependencies.publishThrough(request, startRecord.cursor, emit)

  let result: AgentGraphResult | null = null
  let thrown: unknown = null
  let outputBaseline: OutputBaseline | null = null
  try {
    outputBaseline = (await dependencies.options.outputs?.baseline(request.sessionId)) ?? null
    const sessionInputs =
      (await dependencies.options.describeSessionInputs?.(request.sessionId)) ?? []
    result = await dependencies.options.graphRunner.run(
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
        skills: (await dependencies.options.listEnabledSkills?.()) ?? [],
        streamRequestId: request.requestId
      },
      signal,
      async (event) => {
        if (event.kind === 'activity') {
          const activity = event.event
          const record = await dependencies.options.repositories.events.append(
            dependencies.runtimeEvent(
              request,
              `activity.${activity.type}`,
              null,
              activity,
              `activity.${activity.type}:${activity.activityId}:${activitySequence++}`
            )
          )
          await dependencies.publishThrough(request, record.cursor, emit)
          return
        }
        if (event.kind === 'tool-call-preparing') {
          const record = await dependencies.options.repositories.events.append(
            dependencies.runtimeEvent(
              request,
              'response.tool_preparing',
              null,
              { index: event.index, modelName: event.modelName },
              `response.tool_preparing:${activitySequence++}`
            )
          )
          await dependencies.publishThrough(request, record.cursor, emit)
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
        const record = await dependencies.options.repositories.commitAssistantContentWithEvent(
          request,
          { ...initialAssistant, content: assistantContent() },
          dependencies.runtimeEvent(request, 'response.content', sequence, {
            delta: event.delta,
            contentIndex,
            order: textOrder
          })
        )
        await dependencies.publishThrough(request, record.cursor, emit)
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
              typeof payload.toolId === 'string' &&
              isImageGenerationToolId(payload.toolId) &&
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
                batchRecord =
                  await dependencies.options.repositories.commitAssistantContentWithEvent(
                    request,
                    { ...initialAssistant, content: assistantContent() },
                    dependencies.runtimeEvent(
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
              await dependencies.publishThrough(request, batchRecord.cursor, emit)
              return
            }
          }
          await dependencies.publishThrough(request, record.cursor, emit)
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
              imageRecord = await dependencies.options.repositories.commitAssistantImageWithEvent(
                request,
                { ...initialAssistant, content: assistantContent() },
                dependencies.runtimeEvent(
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
            await dependencies.publishThrough(request, imageRecord.cursor, emit)
          }
        }
      }
    )
  } catch (error) {
    thrown = error
  }

  const occurredAt = dependencies.options.now()
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
  if (completed && outputBaseline && dependencies.options.outputs) {
    const changes = await dependencies.options.outputs.detectChanges(
      request.sessionId,
      outputBaseline
    )
    if (changes.length > 0) {
      registeredOutputs = await dependencies.options.outputs.register({
        sessionId: request.sessionId,
        taskId: request.taskId,
        files: changes
      })
    }
  }
  await dependencies.options.appApprovals?.cancelTask(request.taskId)
  try {
    await dependencies.options.turnEnded?.(request.taskId)
  } catch (error) {
    // Cleanup must not keep the turn from ending; its failure is only reported.
    console.warn('[stream-session] turn cleanup failed', error)
  }
  const endRecord = await dependencies.options.repositories.finishStreamTask({
    request: persistedRequest,
    task,
    assistantMessage: { ...initialAssistant, content: assistantContent() },
    event: dependencies.runtimeEvent(request, 'response.end', sequence, {
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
              uri: legacyResourceUri('generated-output', file.fileId, {
                sessionId: file.sessionId,
                taskId: file.taskId
              }),
              name: file.name,
              mimeType: file.mimeType,
              byteLength: file.byteLength
            }))
          }
        : {}),
      error
    })
  })
  dependencies.releaseSession(request.sessionId)
  await dependencies.publishThrough(persistedRequest, endRecord.cursor, emit)
}
