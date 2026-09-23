import type { ModelRef } from '@actiondriver/contracts'
import { z } from 'zod'

export const STREAM_PROTOCOL = 'actiondriver.stream.v1' as const

const idSchema = z.string().trim().min(1)
const timestampSchema = z.string().trim().min(1)
const protocolSchema = z.literal(STREAM_PROTOCOL)
const modelRefSchema = z
  .object({
    connectionId: idSchema,
    modelId: idSchema
  })
  .strict() satisfies z.ZodType<ModelRef>

const clientBase = {
  protocol: protocolSchema,
  eventId: idSchema,
  createdAt: timestampSchema
} as const

const streamIdentity = {
  protocol: protocolSchema,
  eventId: idSchema,
  cursor: z.number().int().nonnegative(),
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
    content: idSchema
  })
  .strict()

const newSessionRequestCreateEventSchema = z
  .object({
    ...requestCreateBase,
    sessionId: z.null(),
    payload: z
      .object({
        input: requestInputSchema,
        model: modelRefSchema,
        systemPrompt: z.string().optional(),
        skills: z.tuple([])
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
        skills: z.tuple([])
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

const toolDecisionEventSchema = z
  .object({
    type: z.enum(['tool.approve', 'tool.reject']),
    ...clientBase,
    requestId: idSchema,
    taskId: idSchema,
    callId: idSchema,
    argumentsHash: idSchema
  })
  .strict()

export const streamClientEventSchema = z.union([
  authEventSchema,
  requestCreateEventSchema,
  requestCancelEventSchema,
  requestResumeEventSchema,
  toolDecisionEventSchema
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
    sequence: z.literal(0),
    model: modelRefSchema
  })
  .strict()

const responseContentEventSchema = z
  .object({
    type: z.literal('response.content'),
    ...streamIdentity,
    sequence: z.number().int().nonnegative(),
    delta: z.string(),
    contentIndex: z.number().int().nonnegative()
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
    error: streamErrorSchema.nullable()
  })
  .strict()

const responseSnapshotEventSchema = z
  .object({
    type: z.literal('response.snapshot'),
    ...streamIdentity,
    sequence: z.number().int().nonnegative(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    messages: z.array(
      z
        .object({
          id: idSchema,
          role: z.enum(['user', 'assistant']),
          content: z.string(),
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
            argumentsHash: z.string(),
            status: z.enum([
              'proposed',
              'waiting_approval',
              'queued',
              'running',
              'completed',
              'failed',
              'cancelled'
            ]),
            durationMs: z.number().nonnegative(),
            resultSummary: z.string().optional(),
            errorSummary: z.string().optional(),
            activityId: idSchema.nullable().optional(),
            rawInput: z.string().optional(),
            rawOutput: z.string().optional(),
            rawOutputTruncated: z.boolean().optional()
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
  argumentsHash: z.string(),
  activityId: idSchema.nullable(),
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
    .object({
      type: z.literal('tool.cancelled'),
      ...toolStreamBase,
      error: streamErrorSchema.nullable()
    })
    .strict()
] as const

export const streamServerEventSchema = z.discriminatedUnion('type', [
  sessionReadyEventSchema,
  requestAcceptedEventSchema,
  requestErrorEventSchema,
  responseStartEventSchema,
  responseContentEventSchema,
  responseEndEventSchema,
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
export type ResponseEndEvent = z.infer<typeof responseEndEventSchema>
export type ResponseSnapshotEvent = z.infer<typeof responseSnapshotEventSchema>
export type StreamResponseEvent = ResponseStartEvent | ResponseContentEvent | ResponseEndEvent
export type ActivityStreamEvent = Extract<StreamServerEvent, { type: `activity.${string}` }>
export type ToolStreamEvent = Extract<StreamServerEvent, { type: `tool.${string}` }>

export function parseStreamClientEvent(value: unknown): StreamClientEvent {
  return streamClientEventSchema.parse(value)
}

export function parseStreamServerEvent(value: unknown): StreamServerEvent {
  return streamServerEventSchema.parse(value)
}
