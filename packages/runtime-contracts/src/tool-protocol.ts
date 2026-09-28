import { toolIdSchema, toolPresentationSchema } from '@actiondriver/plugin-contracts'
import { z } from 'zod'
import type { ImageAssetRef } from '@actiondriver/contracts'

const idSchema = z.string().trim().min(1)
const jsonObjectSchema = z.record(z.string(), z.json())
const imageAssetRefSchema: z.ZodType<ImageAssetRef> = z
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
export const toolDefinitionSchema = z
  .object({
    id: toolIdSchema,
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
    timeoutMs: z.number().int().positive(),
    presentation: toolPresentationSchema.optional()
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
  z.object({ type: z.literal('tool.unknown'), ...toolEventBase, error: toolErrorSchema }).strict(),
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
      type: z.literal('tool.asset'),
      ...toolEventBase,
      index: z.number().int().nonnegative(),
      asset: imageAssetRefSchema
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
  | { kind: 'asset'; index: number; asset: z.infer<typeof imageAssetRefSchema> }
  | { kind: 'result'; output: z.infer<typeof z.json> }

/** Working directories owned by one session; scripts default to `root`. */
export type SessionWorkspacePaths = {
  root: string
  input: string
  output: string
}

/**
 * Trusted per-call context resolved from persisted state, never from model input.
 * Tools that touch files MUST fail closed when it is absent.
 */
export type ToolExecutionContext = {
  grants?: string[]
  taskId: string
  sessionId: string
  workspace: SessionWorkspacePaths
}

export interface ToolExecutor {
  execute(
    call: ToolCall,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ): AsyncIterable<ToolExecutorEvent>
  /**
   * Returns the safe summary written to history and events in place of the tool's arguments or
   * result. The caller still receives the full values in memory; tools whose data must stay out
   * of storage (screen content, element trees, coordinates) implement this.
   */
  redactForPersistence?(
    kind: 'input' | 'output',
    value: z.infer<typeof z.json>
  ): z.infer<typeof z.json>
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
