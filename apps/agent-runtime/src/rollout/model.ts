import { z } from 'zod'

/**
 * The rollout is the authoritative session log: one append-only JSONL file per
 * session, one record per line. Reading it is a pure left fold, so the live
 * view and a reopened session see the same order without anyone recomputing it.
 */

export const ROLLOUT_ORIGINATOR = 'actiondriver-desktop' as const

const idSchema = z.string().trim().min(1)
const timestampSchema = z.string().trim().min(1)

export const imageAssetRefSchema = z
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
const imageAssetSchema = imageAssetRefSchema

const documentFileSchema = z
  .object({
    fileId: idSchema,
    sessionId: idSchema,
    taskId: idSchema,
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1),
    byteLength: z.number().int().nonnegative()
  })
  .strict()

const base = {
  seq: z.number().int().nonnegative(),
  ts: timestampSchema
} as const

const sessionMetaLineSchema = z
  .object({
    t: z.literal('session_meta'),
    ...base,
    sessionId: idSchema,
    threadId: idSchema,
    model: z.object({ connectionId: idSchema, modelId: idSchema }).strict(),
    originator: idSchema,
    version: idSchema
  })
  .strict()

const turnBeginLineSchema = z
  .object({
    t: z.literal('turn_begin'),
    ...base,
    turnId: idSchema,
    taskId: idSchema,
    goal: z.string(),
    input: z.unknown().optional()
  })
  .strict()

const turnEndLineSchema = z
  .object({
    t: z.literal('turn_end'),
    ...base,
    turnId: idSchema,
    status: z.enum(['completed', 'failed', 'cancelled']),
    durationMs: z.number().nonnegative().optional(),
    content: z.string().optional(),
    error: z.unknown().optional()
  })
  .strict()

const blockLineSchema = z
  .object({
    t: z.literal('block'),
    ...base,
    turnId: idSchema,
    blockId: idSchema,
    kind: z.enum(['text', 'image_batch', 'image', 'document', 'tool_group']),
    /** Single monotonic slot; reserved once and never recomputed. */
    order: z.number().int().nonnegative(),
    /** Slots this record keeps for itself and its children. */
    slots: z.number().int().positive(),
    status: z.enum(['pending', 'streaming', 'completed']),
    /** Text records carry one increment; the fold concatenates them in seq order. */
    delta: z.string().optional(),
    /** An answer the model never streamed: stored for the transcript, never replayed as a delta. */
    text: z.string().optional(),
    phase: z.enum(['pending', 'process', 'final']).optional(),
    callId: idSchema.optional(),
    imageCount: z.number().int().min(1).max(16).optional(),
    asset: imageAssetSchema.optional(),
    generation: z
      .object({ callId: idSchema, index: z.number().int().nonnegative() })
      .strict()
      .optional(),
    file: documentFileSchema.optional(),
    title: z.string().trim().min(1).optional(),
    titleRevision: z.number().int().nonnegative().optional()
  })
  .strict()

const toolLineSchema = z
  .object({
    t: z.literal('tool'),
    ...base,
    turnId: idSchema,
    blockId: idSchema,
    callId: idSchema,
    itemIndex: z.number().int().nonnegative(),
    toolId: idSchema,
    modelName: idSchema,
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
    summary: z.string().optional(),
    title: z.string().optional(),
    argumentsHash: z.string().optional(),
    imageCount: z.number().int().min(1).max(16).optional(),
    durationMs: z.number().nonnegative().optional(),
    resultSummary: z.string().optional(),
    errorSummary: z.string().optional(),
    rawInput: z.string().optional(),
    /** Safe tool input, kept so a reopened snapshot can rebuild galleries and details. */
    input: z.unknown().optional(),
    /** Safe tool output, kept so reopened details and redaction stay intact. */
    output: z.unknown().optional(),
    /** Declared tool presentation, so reopened details keep their semantic fields. */
    presentation: z.unknown().optional(),
    rawOutput: z.string().optional(),
    rawOutputTruncated: z.boolean().optional()
  })
  .strict()

/**
 * Operational events that carry no session content (acceptance, approvals,
 * interruption) are stored verbatim so reconnect can replay them unchanged.
 */
const eventLineSchema = z
  .object({
    t: z.literal('event'),
    ...base,
    turnId: idSchema,
    type: idSchema,
    payload: z.unknown()
  })
  .strict()

/** A plain stored message (agent-mode turns and user submissions). */
const messageLineSchema = z
  .object({
    t: z.literal('message'),
    ...base,
    turnId: idSchema,
    messageId: idSchema,
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.unknown()
  })
  .strict()

/** Activity narration (the timeline side of a streamed delta), kept beside the message text. */
const activityTextLineSchema = z
  .object({
    t: z.literal('activity_text'),
    ...base,
    turnId: idSchema,
    textId: idSchema,
    /** The tool group this narration belonged to, when the model emitted it inside one. */
    activityId: idSchema.nullable().optional(),
    delta: z.string().optional(),
    phase: z.enum(['process', 'final']).optional()
  })
  .strict()

export const rolloutLineSchema = z.discriminatedUnion('t', [
  sessionMetaLineSchema,
  turnBeginLineSchema,
  turnEndLineSchema,
  blockLineSchema,
  toolLineSchema,
  eventLineSchema,
  messageLineSchema,
  activityTextLineSchema
])

export type SessionMetaLine = z.infer<typeof sessionMetaLineSchema>
export type TurnBeginLine = z.infer<typeof turnBeginLineSchema>
export type TurnEndLine = z.infer<typeof turnEndLineSchema>
export type BlockLine = z.infer<typeof blockLineSchema>
export type ToolLine = z.infer<typeof toolLineSchema>
export type EventLine = z.infer<typeof eventLineSchema>
export type MessageLine = z.infer<typeof messageLineSchema>
export type ActivityTextLine = z.infer<typeof activityTextLineSchema>
export type RolloutLine = z.infer<typeof rolloutLineSchema>

export type BlockKind = BlockLine['kind']
export type ToolStatus = ToolLine['status']

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A record before the writer assigns its `seq`. */
export type RolloutLineDraft = DistributiveOmit<RolloutLine, 'seq'>

/**
 * Which of the two task regions a block renders in. The reader filters by
 * `region` and sorts by `order`; it never keeps a second ordering.
 */
export type BlockRegion = 'activity' | 'answer'

export function blockRegion(line: BlockLine): BlockRegion {
  if (line.kind === 'tool_group') return 'activity'
  if (line.kind === 'text') return line.phase === 'process' ? 'activity' : 'answer'
  return 'answer'
}

/** Parses one JSONL line, returning null for anything that is not a valid record. */
export function parseRolloutLine(value: unknown): RolloutLine | null {
  const parsed = rolloutLineSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
