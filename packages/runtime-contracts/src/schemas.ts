import { z } from 'zod'
import { RUNTIME_PROTOCOL_VERSION } from './protocol'

const versionSchema = z.object({
  major: z.literal(RUNTIME_PROTOCOL_VERSION.major),
  minor: z.number().int().nonnegative()
})

const baseEnvelopeFields = {
  requestId: z.string().min(1),
  version: versionSchema
} as const

const skillControlInputSchema = z.object({
  invocationId: z.string().min(1),
  command: z.enum(['pause', 'resume', 'take-over'])
})

const commandPayloadSchema = z.union([
  z.object({ command: z.literal('skill.control'), input: skillControlInputSchema }),
  z.object({
    command: z
      .string()
      .min(1)
      .refine((command) => command !== 'skill.control'),
    input: z.unknown()
  })
])

export const runtimeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional()
})

export const runtimeEventSchema = z.object({
  cursor: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
  occurredAt: z.string().min(1)
})

export const runtimeEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('handshake.request'),
    ...baseEnvelopeFields,
    payload: z.object({
      appVersion: z.string().min(1),
      capabilities: z.array(z.string())
    })
  }),
  z.object({
    type: z.literal('handshake.response'),
    ...baseEnvelopeFields,
    payload: z.object({
      ok: z.boolean(),
      runtimeVersion: z.string().min(1),
      capabilities: z.array(z.string()),
      error: runtimeErrorSchema.optional()
    })
  }),
  z.object({
    type: z.literal('command.request'),
    ...baseEnvelopeFields,
    deadlineUnixMs: z.number().int().positive(),
    payload: commandPayloadSchema
  }),
  z.object({
    type: z.literal('command.response'),
    ...baseEnvelopeFields,
    payload: z.object({
      ok: z.boolean(),
      value: z.unknown().optional(),
      error: runtimeErrorSchema.optional()
    })
  }),
  z.object({
    type: z.literal('event.subscribe'),
    ...baseEnvelopeFields,
    deadlineUnixMs: z.number().int().positive(),
    payload: z.object({
      taskId: z.string().min(1),
      afterCursor: z.number().int().nonnegative()
    })
  }),
  z.object({
    type: z.literal('event.ack'),
    ...baseEnvelopeFields,
    payload: z.object({
      ok: z.boolean(),
      cursor: z.number().int().nonnegative(),
      error: runtimeErrorSchema.optional()
    })
  }),
  z.object({
    type: z.literal('event.item'),
    ...baseEnvelopeFields,
    payload: z.object({
      cursor: z.number().int().nonnegative(),
      event: runtimeEventSchema
    })
  }),
  z.object({
    type: z.literal('skill.execute'),
    ...baseEnvelopeFields,
    deadlineUnixMs: z.number().int().positive(),
    payload: z.object({
      invocationId: z.string().min(1),
      requestedSkillId: z.string().min(1),
      resolvedProviderId: z.string().min(1),
      providerVersion: z.string().min(1),
      input: z.unknown()
    })
  }),
  z.object({
    type: z.literal('skill.result'),
    ...baseEnvelopeFields,
    payload: z.object({
      ok: z.boolean(),
      value: z.unknown().optional(),
      error: runtimeErrorSchema.optional()
    })
  }),
  z.object({
    type: z.literal('runtime.shutdown'),
    ...baseEnvelopeFields,
    payload: z.object({})
  })
])

export type RuntimeEnvelope = z.infer<typeof runtimeEnvelopeSchema>

export function parseRuntimeEnvelope(value: unknown): RuntimeEnvelope {
  return runtimeEnvelopeSchema.parse(value)
}
