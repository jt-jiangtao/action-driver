import { toolPresentationSchema, toolDetailsSchema } from '@actiondriver/plugin-contracts'
import type { ModelRef } from '@actiondriver/contracts'
import { z } from 'zod'

export const STREAM_PROTOCOL = 'actiondriver.stream.v2' as const

const idSchema = z.string().trim().min(1)
const timestampSchema = z.string().trim().min(1)
export const appApprovalRequestSchema = z
  .object({
    requestId: idSchema,
    taskId: idSchema,
    sessionId: idSchema,
    target: z
      .object({
        bundleId: idSchema,
        displayName: idSchema,
        appPath: idSchema,
        risk: z.enum(['high', 'low']),
        warningSubtitle: z.string().optional()
      })
      .strict(),
    allowPersistentApproval: z.boolean()
  })
  .strict()
export type AppApprovalRequest = z.infer<typeof appApprovalRequestSchema>
const protocolSchema = z.literal(STREAM_PROTOCOL)
const modelRefSchema = z
  .object({
    connectionId: idSchema,
    modelId: idSchema
  })
  .strict() satisfies z.ZodType<ModelRef>

const imageAssetSchema = z
  .object({
    assetId: idSchema,
    sessionId: idSchema,
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteLength: z.number().int().positive(),
    source: z.enum(['upload', 'generated'])
  })
  .strict()

const partOrderSchema = z.number().int().nonnegative().optional()

const messagePartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string(), order: partOrderSchema }).strict(),
  z.object({ kind: z.literal('activity'), activityId: idSchema, order: partOrderSchema }).strict(),
  z
    .object({
      kind: z.literal('image-batch'),
      callId: idSchema,
      imageCount: z.number().int().min(1).max(16),
      order: partOrderSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('image'),
      asset: imageAssetSchema,
      generation: z
        .object({ callId: idSchema, index: z.number().int().nonnegative() })
        .strict()
        .optional(),
      order: partOrderSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('document'),
      file: z
        .object({
          fileId: idSchema,
          sessionId: idSchema,
          taskId: idSchema,
          name: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(1),
          byteLength: z.number().int().nonnegative()
        })
        .strict()
    })
    .strict()
])

const clientBase = {
  protocol: protocolSchema,
  eventId: idSchema,
  createdAt: timestampSchema
} as const

const streamIdentity = {
  protocol: protocolSchema,
  eventId: idSchema,
  cursor: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  requestId: idSchema,
  sessionId: idSchema,
  taskId: idSchema,
  responseId: idSchema,
  streamId: idSchema,
  messageId: idSchema,
  occurredAt: timestampSchema
} as const

const streamErrorSchema = z
  .object({
    code: idSchema,
    message: idSchema,
    retryable: z.boolean()
  })
  .strict()

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional()
  })
  .strict()

const authEventSchema = z
  .object({
    type: z.literal('auth'),
    ...clientBase,
    payload: z.object({ token: idSchema }).strict()
  })
  .strict()

const requestCreateBase = {
  type: z.literal('request.create'),
  ...clientBase,
  requestId: idSchema,
  idempotencyKey: idSchema
} as const

const requestInputSchema = z
  .object({
    role: z.literal('user'),
    content: z.string(),
    imageAssetIds: z.array(idSchema).max(4).optional(),
    inputFileIds: z.array(idSchema).max(4).optional()
  })
  .strict()
  .refine(
    (input) =>
      input.content.trim().length > 0 ||
      (input.imageAssetIds?.length ?? 0) > 0 ||
      (input.inputFileIds?.length ?? 0) > 0,
    { message: 'Text, image or file is required' }
  )

const newSessionRequestCreateEventSchema = z
  .object({
    ...requestCreateBase,
    sessionId: z.null(),
    payload: z
      .object({
        input: requestInputSchema,
        model: modelRefSchema,
        systemPrompt: z.string().optional(),
        skills: z.array(z.object({ skillId: idSchema, description: z.string() }).strict()).max(256)
      })
      .strict()
  })
  .strict()

const continuationRequestCreateEventSchema = z
  .object({
    ...requestCreateBase,
    sessionId: idSchema,
    payload: z
      .object({
        input: requestInputSchema,
        systemPrompt: z.string().optional(),
        skills: z.array(z.object({ skillId: idSchema, description: z.string() }).strict()).max(256)
      })
      .strict()
  })
  .strict()

const requestCreateEventSchema = z.union([
  newSessionRequestCreateEventSchema,
  continuationRequestCreateEventSchema
])

const requestCancelEventSchema = z
  .object({
    type: z.literal('request.cancel'),
    ...clientBase,
    requestId: idSchema,
    taskId: idSchema,
    responseId: idSchema
  })
  .strict()

const requestResumeEventSchema = z
  .object({
    type: z.literal('request.resume'),
    ...clientBase,
    requestId: idSchema,
    afterCursor: z.number().int().nonnegative()
  })
  .strict()

export const streamClientEventSchema = z.union([
  authEventSchema,
  requestCreateEventSchema,
  requestCancelEventSchema,
  requestResumeEventSchema
])

const sessionReadyEventSchema = z
  .object({
    type: z.literal('session.ready'),
    protocol: protocolSchema,
    eventId: idSchema,
    connectionId: idSchema,
    capabilities: z.array(idSchema),
    occurredAt: timestampSchema
  })
  .strict()

const requestAcceptedEventSchema = z
  .object({
    type: z.literal('request.accepted'),
    ...streamIdentity
  })
  .strict()

const requestErrorEventSchema = z
  .object({
    type: z.literal('request.error'),
    protocol: protocolSchema,
    eventId: idSchema,
    requestId: idSchema,
    error: streamErrorSchema,
    occurredAt: timestampSchema
  })
  .strict()

const responseStartEventSchema = z
  .object({
    type: z.literal('response.start'),
    ...streamIdentity,
    model: modelRefSchema
  })
  .strict()

const responseContentEventSchema = z
  .object({
    type: z.literal('response.content'),
    ...streamIdentity,
    sequence: z.number().int().nonnegative(),
    delta: z.string(),
    contentIndex: z.number().int().nonnegative(),
    order: z.number().int().nonnegative().optional()
  })
  .strict()

const responseImageEventSchema = z
  .object({
    type: z.literal('response.image'),
    ...streamIdentity,
    asset: imageAssetSchema,
    contentIndex: z.number().int().nonnegative(),
    callId: idSchema,
    index: z.number().int().nonnegative(),
    order: z.number().int().nonnegative().optional()
  })
  .strict()

const responseImageBatchEventSchema = z
  .object({
    type: z.literal('response.image_batch'),
    ...streamIdentity,
    callId: idSchema,
    imageCount: z.number().int().min(1).max(16),
    contentIndex: z.number().int().nonnegative(),
    order: z.number().int().nonnegative().optional()
  })
  .strict()

const responseToolPreparingEventSchema = z
  .object({
    type: z.literal('response.tool_preparing'),
    ...streamIdentity,
    index: z.number().int().nonnegative(),
    modelName: idSchema
  })
  .strict()

const responseEndEventSchema = z
  .object({
    type: z.literal('response.end'),
    ...streamIdentity,
    sequence: z.number().int().nonnegative(),
    status: z.enum(['completed', 'failed', 'cancelled']),
    content: z.string(),
    finishReason: z.string().nullable(),
    usage: usageSchema.nullable(),
    durationMs: z.number().nonnegative(),
    outputFiles: z
      .array(
        z
          .object({
            fileId: idSchema,
            sessionId: idSchema,
            taskId: idSchema,
            name: z.string().trim().min(1).max(255),
            mimeType: z.string().trim().min(1),
            byteLength: z.number().int().nonnegative()
          })
          .strict()
      )
      .optional(),
    error: streamErrorSchema.nullable()
  })
  .strict()

const runtimeInterruptedEventSchema = z
  .object({
    type: z.literal('runtime.interrupted'),
    ...streamIdentity,
    error: streamErrorSchema
  })
  .strict()

const responseSnapshotEventSchema = z
  .object({
    type: z.literal('response.snapshot'),
    ...streamIdentity,
    sequence: z.number().int().nonnegative(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    pendingAppApproval: z.array(appApprovalRequestSchema).optional(),
    messages: z.array(
      z
        .object({
          id: idSchema,
          role: z.enum(['user', 'assistant']),
          content: z.string(),
          parts: z.array(messagePartSchema).optional(),
          createdAt: timestampSchema
        })
        .strict()
    ),
    tools: z
      .array(
        z
          .object({
            callId: idSchema,
            toolId: idSchema,
            modelName: idSchema,
            summary: z.string(),
            title: z.string().optional(),
            argumentsHash: z.string(),
            imageCount: z.number().int().min(1).max(16).optional(),
            status: z.enum([
              'proposed',
              'waiting_approval',
              'queued',
              'running',
              'completed',
              'failed',
              'cancelled',
              'unknown'
            ]),
            durationMs: z.number().nonnegative(),
            resultSummary: z.string().optional(),
            errorSummary: z.string().optional(),
            activityId: idSchema.nullable().optional(),
            presentation: toolPresentationSchema.optional(),
            details: toolDetailsSchema.optional(),
            rawInput: z.string().optional(),
            rawOutput: z.string().optional(),
            rawOutputTruncated: z.boolean().optional()
          })
          .strict()
      )
      .optional(),
    outputFiles: z
      .array(
        z
          .object({
            fileId: idSchema,
            sessionId: idSchema,
            taskId: idSchema,
            name: z.string().trim().min(1).max(255),
            mimeType: z.string().trim().min(1),
            byteLength: z.number().int().nonnegative()
          })
          .strict()
      )
      .optional(),
    activities: z
      .array(
        z
          .object({
            activityId: idSchema,
            title: z.string(),
            titleRevision: z.number().int().nonnegative(),
            status: z.enum(['running', 'completed']),
            items: z.array(
              z.union([
                z
                  .object({
                    id: idSchema,
                    kind: z.literal('text'),
                    content: z.string(),
                    phase: z.enum(['pending', 'process', 'final']).optional()
                  })
                  .strict(),
                z.object({ id: idSchema, kind: z.literal('tool'), callId: idSchema }).strict()
              ])
            )
          })
          .strict()
      )
      .optional(),
    activityTimeline: z
      .array(
        z.union([
          z.object({ id: idSchema, kind: z.literal('activity'), activityId: idSchema }).strict(),
          z.object({ id: idSchema, kind: z.literal('tool'), callId: idSchema }).strict(),
          z
            .object({
              id: idSchema,
              kind: z.literal('text'),
              content: z.string(),
              phase: z.enum(['pending', 'process', 'final']).optional()
            })
            .strict()
        ])
      )
      .optional(),
    durationMs: z.number().nonnegative().optional(),
    preparingToolName: idSchema.optional(),
    error: streamErrorSchema.nullable()
  })
  .strict()

const activityStreamBase = {
  ...streamIdentity,
  activityId: idSchema
} as const

const activityStreamEventSchemas = [
  z
    .object({
      type: z.literal('activity.started'),
      ...activityStreamBase,
      title: z.string().trim().min(1),
      titleRevision: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      type: z.literal('activity.updated'),
      ...activityStreamBase,
      title: z.string().trim().min(1),
      titleRevision: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      type: z.literal('activity.text'),
      ...streamIdentity,
      activityId: idSchema.nullable(),
      textId: idSchema.optional(),
      delta: z.string()
    })
    .strict(),
  z
    .object({
      type: z.literal('activity.text.done'),
      ...streamIdentity,
      activityId: idSchema.nullable(),
      textId: idSchema,
      phase: z.enum(['process', 'final'])
    })
    .strict(),
  z.object({ type: z.literal('activity.completed'), ...activityStreamBase }).strict()
] as const

const toolStreamBase = {
  ...streamIdentity,
  callId: idSchema,
  callSequence: z.number().int().nonnegative(),
  toolId: idSchema,
  modelName: idSchema,
  summary: z.string(),
  title: z.string().optional(),
  argumentsHash: z.string(),
  imageCount: z.number().int().min(1).max(16).optional(),
  activityId: idSchema.nullable(),
  presentation: toolPresentationSchema.optional(),
  details: toolDetailsSchema.optional(),
  rawInput: z.string().optional(),
  rawOutputTruncated: z.boolean().optional()
} as const

const toolStreamEventSchemas = [
  z.object({ type: z.literal('tool.proposed'), ...toolStreamBase }).strict(),
  z.object({ type: z.literal('tool.waiting_approval'), ...toolStreamBase }).strict(),
  z.object({ type: z.literal('tool.queued'), ...toolStreamBase }).strict(),
  z.object({ type: z.literal('tool.running'), ...toolStreamBase }).strict(),
  z
    .object({
      type: z.literal('tool.content'),
      ...toolStreamBase,
      stream: z.enum(['stdout', 'stderr', 'result']),
      delta: z.string()
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.asset'),
      ...toolStreamBase,
      index: z.number().int().nonnegative(),
      asset: imageAssetSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.completed'),
      ...toolStreamBase,
      durationMs: z.number().nonnegative(),
      resultSummary: z.string(),
      rawOutput: z.string().optional()
    })
    .strict(),
  z
    .object({ type: z.literal('tool.failed'), ...toolStreamBase, error: streamErrorSchema })
    .strict(),
  z
    .object({ type: z.literal('tool.unknown'), ...toolStreamBase, error: streamErrorSchema })
    .strict(),
  z
    .object({
      type: z.literal('tool.cancelled'),
      ...toolStreamBase,
      error: streamErrorSchema.nullable()
    })
    .strict()
] as const

const appApprovalRequestedEventSchema = z
  .object({
    type: z.literal('computer.app-approval.requested'),
    ...streamIdentity,
    approval: appApprovalRequestSchema
  })
  .strict()
const appApprovalResolvedEventSchema = z
  .object({
    type: z.literal('computer.app-approval.resolved'),
    ...streamIdentity,
    approval: appApprovalRequestSchema,
    decision: z.enum(['once', 'session', 'always', 'deny', 'cancelled'])
  })
  .strict()

export const streamServerEventSchema = z.discriminatedUnion('type', [
  appApprovalRequestedEventSchema,
  appApprovalResolvedEventSchema,
  sessionReadyEventSchema,
  requestAcceptedEventSchema,
  requestErrorEventSchema,
  responseStartEventSchema,
  responseContentEventSchema,
  responseImageEventSchema,
  responseImageBatchEventSchema,
  responseToolPreparingEventSchema,
  responseEndEventSchema,
  runtimeInterruptedEventSchema,
  responseSnapshotEventSchema,
  ...activityStreamEventSchemas,
  ...toolStreamEventSchemas
])

export type StreamClientEvent = z.infer<typeof streamClientEventSchema>
export type StreamServerEvent = z.infer<typeof streamServerEventSchema>
export type RequestCreateEvent = z.infer<typeof requestCreateEventSchema>
export type RequestAcceptedEvent = z.infer<typeof requestAcceptedEventSchema>
export type ResponseStartEvent = z.infer<typeof responseStartEventSchema>
export type ResponseContentEvent = z.infer<typeof responseContentEventSchema>
export type ResponseImageEvent = z.infer<typeof responseImageEventSchema>
export type ResponseImageBatchEvent = z.infer<typeof responseImageBatchEventSchema>
export type ResponseEndEvent = z.infer<typeof responseEndEventSchema>
export type ResponseSnapshotEvent = z.infer<typeof responseSnapshotEventSchema>
export type StreamResponseEvent =
  | ResponseStartEvent
  | ResponseContentEvent
  | ResponseImageEvent
  | ResponseImageBatchEvent
  | z.infer<typeof responseToolPreparingEventSchema>
  | ResponseEndEvent
export type ActivityStreamEvent = Extract<StreamServerEvent, { type: `activity.${string}` }>
export type ToolStreamEvent = Extract<StreamServerEvent, { type: `tool.${string}` }>

export function parseStreamClientEvent(value: unknown): StreamClientEvent {
  return streamClientEventSchema.parse(value)
}

export function parseStreamServerEvent(value: unknown): StreamServerEvent {
  return streamServerEventSchema.parse(value)
}
