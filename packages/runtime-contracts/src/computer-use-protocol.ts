import { z } from 'zod'

const requestBase = {
  version: z.literal(1),
  requestId: z.string().min(1).max(128),
  deadlineUnixMs: z.number().int().positive()
} as const

const finiteCoordinate = z.number().finite().min(-100_000).max(100_000)
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: finiteCoordinate, y: finiteCoordinate }).strict(),
  z.object({ type: z.literal('click-element'), elementRef: z.string().min(1).max(256) }).strict(),
  z.object({ type: z.literal('type'), text: z.string().max(8_192) }).strict(),
  z.object({ type: z.literal('key'), key: z.string().min(1).max(64), modifiers: z.array(z.enum(['command', 'control', 'option', 'shift'])).max(4) }).strict(),
  z.object({ type: z.literal('scroll'), deltaX: z.number().finite().min(-10_000).max(10_000), deltaY: z.number().finite().min(-10_000).max(10_000) }).strict(),
  z.object({ type: z.literal('wait'), milliseconds: z.number().int().min(0).max(10_000) }).strict()
])

export const computerHelperRequest = z.discriminatedUnion('operation', [
  z.object({ ...requestBase, operation: z.literal('permissions'),
    prompt: z.boolean().optional(),
    target: z.enum(['accessibility', 'screenRecording', 'eventPosting']).optional() }).strict(),
  z.object({ ...requestBase, operation: z.literal('observe'), maxElements: z.number().int().min(1).max(500), maxDepth: z.number().int().min(1).max(12) }).strict(),
  z.object({ ...requestBase, operation: z.literal('capture'), maxWidth: z.number().int().min(1).max(4096), maxHeight: z.number().int().min(1).max(4096) }).strict(),
  z.object({ ...requestBase, operation: z.literal('act'), observationId: z.string().min(1).max(128), action }).strict(),
  z.object({ ...requestBase, operation: z.literal('cancel'), targetRequestId: z.string().min(1).max(128) }).strict(),
  z.object({ ...requestBase, operation: z.literal('shutdown') }).strict(),
  z.object({ ...requestBase, operation: z.literal('guidance') }).strict()
])

const error = z.object({
  code: z.enum(['ACCESSIBILITY_DENIED', 'SCREEN_RECORDING_DENIED', 'STALE_REFERENCE', 'INVALID_REQUEST', 'CANCELLED', 'TIMED_OUT', 'ENGINE_UNAVAILABLE', 'ACTION_FAILED']),
  message: z.string().min(1).max(1_024)
}).strict()

export const computerHelperResponse = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), requestId: z.string().min(1).max(128), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(1), requestId: z.string().min(1).max(128), ok: z.literal(false), error }).strict()
])

export type ComputerHelperRequest = z.infer<typeof computerHelperRequest>
export type ComputerHelperResponse = z.infer<typeof computerHelperResponse>
