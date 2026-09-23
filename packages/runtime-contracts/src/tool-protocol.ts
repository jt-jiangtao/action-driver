import { z } from 'zod'

const idSchema = z.string().trim().min(1)
const jsonObjectSchema = z.record(z.string(), z.json())
export const toolDefinitionSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    modelName: z.string().regex(/^[A-Za-z0-9_-]+$/),
    description: idSchema,
    inputSchema: jsonObjectSchema.refine((schema) => schema.type === 'object', {
      message: 'Tool input schema must describe an object'
    }),
    risk: z.enum(['low', 'medium', 'high']),
    sideEffects: z
      .object({
        filesystem: z.enum(['none', 'read', 'write']),
        network: z.boolean()
      })
      .strict(),
    timeoutMs: z.number().int().positive()
  })
  .strict()

export const toolCallSchema = z
  .object({
    callId: idSchema,
    providerCallId: idSchema,
    modelName: idSchema,
    arguments: jsonObjectSchema
  })
  .strict()

const toolEventBase = {
  callId: idSchema,
  taskId: idSchema,
  sequence: z.number().int().nonnegative()
} as const

const toolErrorSchema = z
  .object({
    code: idSchema,
    message: idSchema,
    retryable: z.boolean()
  })
  .strict()

export const toolEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool.proposed'), ...toolEventBase }).strict(),
  z.object({ type: z.literal('tool.waiting_approval'), ...toolEventBase }).strict(),
  z.object({ type: z.literal('tool.queued'), ...toolEventBase }).strict(),
  z.object({ type: z.literal('tool.running'), ...toolEventBase }).strict(),
  z
    .object({
      type: z.literal('tool.content'),
      ...toolEventBase,
      stream: z.enum(['stdout', 'stderr', 'result']),
      delta: z.string()
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.completed'),
      ...toolEventBase,
      output: z.json()
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.failed'),
      ...toolEventBase,
      error: toolErrorSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.cancelled'),
      ...toolEventBase,
      error: toolErrorSchema.nullable()
    })
    .strict()
])

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>
export type ToolCall = z.infer<typeof toolCallSchema>
export type ToolEvent = z.infer<typeof toolEventSchema>
export type ToolError = z.infer<typeof toolErrorSchema>
export type ToolDecision = { kind: 'allow' } | { kind: 'deny'; error: ToolError }

export type ToolExecutorEvent =
  | { kind: 'content'; stream: 'stdout' | 'stderr' | 'result'; delta: string }
  | { kind: 'result'; output: z.infer<typeof z.json> }

export interface ToolExecutor {
  execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent>
}

export function parseToolDefinition(value: unknown): ToolDefinition {
  return toolDefinitionSchema.parse(value)
}

export function parseToolCall(value: unknown): ToolCall {
  return toolCallSchema.parse(value)
}

export function parseToolEvent(value: unknown): ToolEvent {
  return toolEventSchema.parse(value)
}
