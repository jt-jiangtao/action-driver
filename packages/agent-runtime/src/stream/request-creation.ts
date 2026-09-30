import type { MessageContentPart } from '@action-driver/contracts'
import type { ModelInputMessage } from '@action-driver/model-connections'
import type { RequestCreateEvent } from '@action-driver/runtime-contracts'
import type { AssetPort, BoundInputFile } from '../host-ports'
import type { PersistedMessage, PersistedStreamRequest, RuntimeTaskRecord } from '../ports'
import { attachmentErrorCode } from './stream-values'
import { readSessionHistory } from './session-history'
import type { StreamEventFactory, StreamSessionOptions } from './session-context'

export type RequestCreationResult =
  | { kind: 'existing'; request: PersistedStreamRequest }
  | { kind: 'rejected'; code: string; message: string }
  | {
      kind: 'created'
      persisted: boolean
      request: PersistedStreamRequest
      task: RuntimeTaskRecord
      assistantMessage: PersistedMessage
      history: ModelInputMessage[]
      currentMessage: ModelInputMessage | undefined
    }

export type RequestCreationDependencies = {
  options: StreamSessionOptions
  isSessionActive(sessionId: string): boolean
  reserveSession(sessionId: string): void
  releaseSession(sessionId: string): void
  runtimeEvent: StreamEventFactory
}

function rejected(code: string, message: string): RequestCreationResult {
  return { kind: 'rejected', code, message }
}

export async function createStreamRequest(
  dependencies: RequestCreationDependencies,
  event: RequestCreateEvent
): Promise<RequestCreationResult> {
  const { options } = dependencies
  const existing = await options.repositories.streamRequests.getByIdempotencyKey(
    event.idempotencyKey
  )
  if (existing) return { kind: 'existing', request: existing }

  const previous = event.sessionId
    ? await options.repositories.tasks.getLatestBySession(event.sessionId)
    : null
  if (event.sessionId && !previous) {
    return rejected('session-not-found', 'Unknown session')
  }
  if (
    previous &&
    (previous.status === 'running' || dependencies.isSessionActive(previous.sessionId))
  ) {
    return rejected('session-busy', 'Another task is running in this session')
  }

  const now = options.now()
  const sessionId = previous?.sessionId ?? options.ids.next('session')
  const model = previous?.model ?? (event.sessionId === null ? event.payload.model : null)
  if (!model) {
    return rejected('session-not-found', 'Unknown session')
  }
  const imageIds = event.payload.input.imageAssetIds ?? []
  if (imageIds.length > 0 && !options.assets) {
    return rejected('image-unavailable', 'Image storage is unavailable')
  }
  let boundAssets: Awaited<ReturnType<AssetPort['bindStaged']>>[] = []
  try {
    boundAssets = await Promise.all(
      imageIds.map((assetId) => options.assets!.bindStaged(assetId, sessionId))
    )
  } catch (error) {
    console.warn('[stream-session] image asset bind failed', error)
    return rejected('image-invalid', `Image cannot be attached (${attachmentErrorCode(error)})`)
  }
  const userParts: MessageContentPart[] = [
    ...(event.payload.input.content
      ? [{ kind: 'text' as const, text: event.payload.input.content }]
      : []),
    ...boundAssets.map((asset) => ({ kind: 'image' as const, asset }))
  ]
  const history = previous ? await readSessionHistory(options.repositories, previous.sessionId) : []
  const userMessageId = options.ids.next('message')
  const assistantMessageId = options.ids.next('message')
  const request: PersistedStreamRequest = {
    requestId: event.requestId,
    idempotencyKey: event.idempotencyKey,
    sessionId,
    taskId: options.ids.next('task'),
    responseId: options.ids.next('response'),
    streamId: options.ids.next('stream'),
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
    if (!options.inputFiles) {
      return rejected('input-unavailable', 'File storage is unavailable')
    }
    try {
      boundInputs = []
      for (const fileId of inputFileIds) {
        boundInputs.push(
          await options.inputFiles.bind(fileId, {
            sessionId,
            taskId: request.taskId
          })
        )
      }
    } catch (error) {
      console.warn('[stream-session] input file bind failed', error)
      return rejected('input-invalid', `File cannot be attached (${attachmentErrorCode(error)})`)
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
  const acceptedEvent = dependencies.runtimeEvent(request, 'request.accepted', null, {})
  dependencies.reserveSession(sessionId)
  let created
  try {
    created = await options.repositories.createStreamTask({
      request,
      task,
      userMessage,
      assistantMessage,
      acceptedEvent
    })
  } catch (error) {
    dependencies.releaseSession(sessionId)
    throw error
  }
  return {
    kind: 'created',
    persisted: created.created,
    request: created.request,
    task,
    assistantMessage,
    history,
    currentMessage: boundAssets.length > 0 ? { role: 'user', content: userParts } : undefined
  }
}
