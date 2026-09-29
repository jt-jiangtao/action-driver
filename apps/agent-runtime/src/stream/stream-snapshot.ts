import {
  projectToolDetails,
  toolPresentationSchema,
  type ToolPresentation
} from '@actiondriver/plugin-contracts'
import {
  emptyActivityTimelineState,
  reduceActivityProjection
} from '@actiondriver/activity-projection'
import { normalizeAssistantParts } from '@actiondriver/contracts'
import type { AppApprovalRequest } from '@actiondriver/contracts'
import {
  STREAM_PROTOCOL,
  parseStreamServerEvent,
  type StreamServerEvent
} from '@actiondriver/runtime-contracts'
import type {
  PersistedStreamRequest,
  RuntimeEventRecord,
  StreamSessionRepository
} from '../ports'
import { persistedToolActivity } from '../tool-activity'
import { boundedJson, messageParts, messageText, toStreamError, withAssets } from './stream-values'

export type SnapshotEvent = Extract<StreamServerEvent, { type: 'response.snapshot' }>

export type SnapshotOptions = {
  repositories: Pick<StreamSessionRepository, 'readStreamSnapshot'>
  toServerEvent(request: PersistedStreamRequest, record: RuntimeEventRecord): StreamServerEvent
  nextEventId(): string
  now(): string
  rawToolIO?: { enabled: boolean; maxBytes?: number }
  toolPresentation?: (toolId: string) => ToolPresentation | undefined
  isActive(requestId: string): boolean
  pendingAppApprovals(taskId: string): readonly AppApprovalRequest[] | undefined
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
}

export async function buildStreamSnapshot(
  options: SnapshotOptions,
  requestId: string
): Promise<SnapshotEvent> {
  const {
    request,
    cursor,
    task,
    messages,
    tools: toolInvocations,
    events
  } = await options.repositories.readStreamSnapshot(requestId)
  const activity = events
    .map((event) => options.toServerEvent(request, event))
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
    eventId: options.nextEventId(),
    cursor,
    requestId: request.requestId,
    sessionId: request.sessionId,
    taskId: request.taskId,
    responseId: request.responseId,
    streamId: request.streamId,
    messageId: request.messageId,
    occurredAt: options.now(),
    sequence: request.lastSequence,
    status: request.status,
    pendingAppApproval:
      request.status === 'running' && options.isActive(request.requestId)
        ? [...(options.pendingAppApprovals(request.taskId) ?? [])]
        : [],
    ...(await outputFilesFor(options, request.taskId)),
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
      const rawToolIO = options.rawToolIO?.enabled === true
      const maxRawBytes = options.rawToolIO?.maxBytes ?? 64 * 1024
      const metadata = [...events]
        .reverse()
        .find(
          (event) =>
            (event.payload as { callId?: string }).callId === invocation.id &&
            Object.hasOwn(event.payload as object, 'presentation')
        )?.payload as { presentation?: unknown } | undefined
      const presentation = metadata
        ? toolPresentationSchema.safeParse(metadata.presentation).data
        : options.toolPresentation?.(invocation.toolId)
      const assets = events
        .filter(
          (event) =>
            event.type === 'tool.asset' &&
            (event.payload as { callId?: string }).callId === invocation.id
        )
        .map((event) => (event.payload as { asset?: unknown }).asset)
      const output = withAssets(invocation.output, assets)
      const rawInput = rawToolIO ? boundedJson(invocation.input, maxRawBytes) : null
      const rawOutput = rawToolIO ? boundedJson(invocation.output, maxRawBytes) : null
      return {
        callId: invocation.id,
        toolId: invocation.toolId,
        modelName: invocation.toolId,
        ...persisted,
        argumentsHash: invocation.argumentsHash,
        ...(invocation.toolId === 'tools/local/image-generation/generate' &&
        Array.isArray((invocation.input as { images?: unknown }).images) &&
        (invocation.input as { images: unknown[] }).images.length >= 1 &&
        (invocation.input as { images: unknown[] }).images.length <= 16
          ? { imageCount: (invocation.input as { images: unknown[] }).images.length }
          : {}),
        status: invocation.status,
        activityId,
        ...(rawToolIO
          ? {
              details: projectToolDetails(presentation, invocation.input, output, {
                maxBytes: maxRawBytes
              }),
              ...(presentation ? { presentation } : {})
            }
          : {}),
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

async function outputFilesFor(
  options: SnapshotOptions,
  taskId: string
): Promise<{
  outputFiles?: Array<{
    fileId: string
    sessionId: string
    taskId: string
    name: string
    mimeType: string
    byteLength: number
  }>
}> {
  const files = (await options.listOutputs?.(taskId)) ?? []
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
