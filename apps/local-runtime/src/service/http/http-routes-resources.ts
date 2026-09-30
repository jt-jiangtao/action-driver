import type { Hono } from 'hono'
import { z } from 'zod'
import { ResourceError } from '@action-driver/runtime-contracts'
import type { ResourceEntry, ResourceReadResult, ResourceScope, ResourceWriteRequest } from '@action-driver/runtime-contracts'
import { success } from './http-contract'

/** Inline reads stay bounded; larger resources must be streamed by a dedicated surface. */
export const RESOURCE_INLINE_MAX_BYTES = 8 * 1024 * 1024

export type ResourceRoutesPort = {
  read(uri: string, scope: ResourceScope): Promise<ResourceReadResult>
  list(uri: string, scope: ResourceScope): Promise<ResourceEntry[]>
  write(uri: string, request: ResourceWriteRequest, scope: ResourceScope): Promise<ResourceEntry>
}

const requestSchema = z.object({
  uri: z.string().min(1),
  taskId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  version: z.string().min(1).optional()
}).strict()

const writeRequestSchema = requestSchema.extend({
  expectedVersion: z.string().min(1).optional(),
  createOnly: z.boolean().optional(),
  contentType: z.string().min(1).max(128).optional(),
  base64: z.string()
}).strict()

function scopeOf(input: z.infer<typeof requestSchema>): ResourceScope {
  return { sessionId: input.sessionId, ...(input.taskId ? { taskId: input.taskId } : {}), ...(input.version ? { version: input.version } : {}) }
}

async function bounded(read: ResourceReadResult): Promise<{ base64: string; byteLength: number }> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of read.stream) {
    size += chunk.byteLength
    if (size > RESOURCE_INLINE_MAX_BYTES) throw new ResourceError('RESOURCE_UNSUPPORTED', `${read.uri}: resource exceeds the inline read limit`)
    chunks.push(chunk)
  }
  return { base64: Buffer.concat(chunks).toString('base64'), byteLength: size }
}

/**
 * The scope in the body names the task the caller is looking at; ownership is still re-checked
 * against persisted records by the provider, so a forged scope cannot widen access.
 */
export function registerResourceRoutes(app: Hono, options: ResourceRoutesPort): void {
  app.post('/resources/read', async context => {
    const input = requestSchema.parse(await context.req.json())
    const read = await options.read(input.uri, scopeOf(input))
    const { base64, byteLength } = await bounded(read)
    return context.json(success({ uri: read.uri, version: read.version, byteLength, base64, ...(read.contentType ? { contentType: read.contentType } : {}) }))
  })
  app.post('/resources/list', async context => {
    const input = requestSchema.parse(await context.req.json())
    return context.json(success(await options.list(input.uri, scopeOf(input))))
  })
  app.post('/resources/write', async context => {
    const input = writeRequestSchema.parse(await context.req.json())
    const bytes = Buffer.from(input.base64, 'base64')
    if (bytes.byteLength === 0) throw new ResourceError('RESOURCE_INVALID_URI', `${input.uri}: write body is empty`)
    if (bytes.byteLength > RESOURCE_INLINE_MAX_BYTES) throw new ResourceError('RESOURCE_UNSUPPORTED', `${input.uri}: write exceeds the inline limit`)
    const stream = (async function * () { yield new Uint8Array(bytes) })()
    const entry = await options.write(input.uri, {
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
      ...(input.createOnly ? { createOnly: input.createOnly } : {}),
      ...(input.contentType ? { contentType: input.contentType } : {}),
      stream
    }, scopeOf(input))
    return context.json(success(entry))
  })
}
