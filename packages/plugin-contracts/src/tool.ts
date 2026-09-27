export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
import { z } from 'zod'
import { toolPresentationSchema } from './tool-presentation.js'
import type { InvocationContext, Json } from './index.js'
// Portable public DTOs. No Runtime/Desktop implementation or repository path crosses this API.
export const pluginToolDefinitionSchema = z.object({
  id: z.string().trim().min(1), version: z.number().int().positive(),
  modelName: z.string().regex(/^[A-Za-z0-9_-]+$/), description: z.string().trim().min(1),
  inputSchema: z.record(z.string(), z.json()).refine(value => value.type === 'object', 'Tool schema must describe an object'),
  risk: z.enum(['low', 'medium', 'high']),
  sideEffects: z.object({ filesystem: z.enum(['none', 'read', 'write']), network: z.boolean() }).strict(),
  timeoutMs: z.number().int().positive(), presentation: toolPresentationSchema.optional()
}).strict()
export type ToolDefinition = z.infer<typeof pluginToolDefinitionSchema>
export interface ToolCall { callId: string; providerCallId: string; modelName: string; arguments: Record<string, Json> }
export interface ToolExecutionContext { grants?: string[]; taskId: string; sessionId: string; workspace: { root: string; input: string; output: string } }
export interface ImageAssetRef { assetId: string; sessionId: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number; byteLength: number; source: 'upload' | 'generated' }
export type ToolExecutorEvent = { kind: 'content'; stream: 'stdout' | 'stderr' | 'result'; delta: string } | { kind: 'asset'; index: number; asset: ImageAssetRef } | { kind: 'result'; output: Json }
export interface ToolExecutor {
  execute(call: ToolCall, signal?: AbortSignal, context?: ToolExecutionContext, invocation?: InvocationContext): AsyncIterable<ToolExecutorEvent>
  redactForPersistence?(kind: 'input' | 'output', value: Json): Json
}
