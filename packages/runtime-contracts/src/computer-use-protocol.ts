import { z } from 'zod'

const requestBase = {
  version: z.literal(1),
  requestId: z.string().min(1).max(128),
  deadlineUnixMs: z.number().int().positive()
} as const

const finiteCoordinate = z.number().finite().min(-100_000).max(100_000)
// 4.1: the observation-based `observe` / `capture` / `act` operations are gone; every desktop
// operation is addressed by application (see the application request set below).
const legacyComputerHelperRequest = z.discriminatedUnion('operation', [
  z.object({ ...requestBase, operation: z.literal('list-apps') }).strict(),
  z.object({ ...requestBase, operation: z.literal('permissions'),
    prompt: z.boolean().optional(),
    target: z.enum(['accessibility', 'screenRecording', 'eventPosting']).optional() }).strict(),
  z.object({ ...requestBase, operation: z.literal('cancel'), targetRequestId: z.string().min(1).max(128) }).strict(),
  z.object({ ...requestBase, operation: z.literal('shutdown') }).strict(),
  z.object({ ...requestBase, operation: z.literal('guidance') }).strict()
])

const elementIndex = z.number().int().min(0).max(1_000_000)
const appTarget = { app: z.string().min(1).max(512), sessionId: z.string().min(1).max(128) }
const mouseOptions = {
  mouseButton: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().min(1).max(3).optional()
}
const indexedAction = z.union([
  z.object({ type: z.literal('click'), x: finiteCoordinate, y: finiteCoordinate, ...mouseOptions }).strict(),
  z.object({ type: z.literal('click-element'), elementIndex, ...mouseOptions }).strict(),
  z.object({ type: z.literal('type'), text: z.string().max(8_192) }).strict(),
  z.object({ type: z.literal('key'), key: z.string().min(1).max(64),
    modifiers: z.array(z.enum(['command', 'control', 'option', 'shift'])).max(4) }).strict(),
  z.object({ type: z.literal('scroll'), elementIndex,
    deltaX: z.number().finite().min(-10_000).max(10_000),
    deltaY: z.number().finite().min(-10_000).max(10_000) }).strict(),
  z.object({ type: z.literal('scroll'), x: finiteCoordinate, y: finiteCoordinate,
    deltaX: z.number().finite().min(-10_000).max(10_000),
    deltaY: z.number().finite().min(-10_000).max(10_000) }).strict(),
  z.object({ type: z.literal('wait'), milliseconds: z.number().int().min(0).max(10_000) }).strict(),
  z.object({ type: z.literal('set-value'), elementIndex, value: z.string().max(8_192) }).strict(),
  z.object({ type: z.literal('paste'), text: z.string().max(200_000), format: z.enum(['text', 'md', 'html']) }).strict(),
  z.object({ type: z.literal('select-text'), elementIndex, text: z.string().max(8_192),
    prefix: z.string().max(2_048).optional(), suffix: z.string().max(2_048).optional(),
    selectionType: z.enum(['text', 'cursor-before', 'cursor-after']).optional() }).strict(),
  z.object({ type: z.literal('drag'), fromX: finiteCoordinate, fromY: finiteCoordinate,
    toX: finiteCoordinate, toY: finiteCoordinate }).strict(),
  z.object({ type: z.literal('secondary-action'), elementIndex, action: z.string().min(1).max(128) }).strict()
])

// Requests stay disjoint per operation; the application set below is the only desktop surface.
const applicationComputerHelperRequest = z.discriminatedUnion('operation', [
  z.object({ ...requestBase, operation: z.literal('app-policy'), app: appTarget.app }).strict(),
  z.object({ ...requestBase, operation: z.literal('session-start'),
    sessionId: z.string().min(1).max(128) }).strict(),
  z.object({ ...requestBase, operation: z.literal('session-end'),
    sessionId: z.string().min(1).max(128) }).strict(),
  z.object({ ...requestBase, ...appTarget, operation: z.literal('app-state'),
    maxElements: z.number().int().min(1).max(500), maxDepth: z.number().int().min(1).max(12),
    disableDiff: z.boolean().optional(), screenshot: z.boolean().optional() }).strict(),
  z.object({ ...requestBase, ...appTarget, operation: z.literal('act'), action: indexedAction }).strict()
])
export const computerHelperRequest = z.union([legacyComputerHelperRequest, applicationComputerHelperRequest])

const error = z.object({
  code: z.enum(['ACCESSIBILITY_DENIED', 'SCREEN_RECORDING_DENIED', 'STALE_REFERENCE', 'INVALID_REQUEST', 'CANCELLED', 'TIMED_OUT', 'ENGINE_UNAVAILABLE', 'ACTION_FAILED',
    'APP_FORBIDDEN', 'APP_DENIED', 'AMBIGUOUS_APP', 'APP_BUSY', 'USER_STOPPED_SESSION',
    'USER_INTERVENED', 'BACKGROUND_INPUT_UNSUPPORTED']),
  message: z.string().min(1).max(1_024)
}).strict()

export const computerHelperResponse = z.discriminatedUnion('ok', [
  z.object({ version: z.literal(1), requestId: z.string().min(1).max(128), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ version: z.literal(1), requestId: z.string().min(1).max(128), ok: z.literal(false), error }).strict()
])

export type ComputerHelperRequest = z.infer<typeof computerHelperRequest>
export type ComputerHelperResponse = z.infer<typeof computerHelperResponse>
