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
    type: z.literal('command.request'),
    ...baseEnvelopeFields,
    deadlineUnixMs: z.number().int().positive(),
    payload: z.object({ command: z.string().min(1), input: z.unknown() })
  }),
  z.object({
    type: z.literal('command.response'),
    ...baseEnvelopeFields,
    payload: z.object({
      ok: z.boolean(),
      value: z.unknown().optional(),
      error: z.unknown().optional()
    })
  }),
  z.object({
    type: z.literal('event.item'),
    ...baseEnvelopeFields,
    payload: z.object({
      cursor: z.number().int().nonnegative(),
      event: z.unknown()
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
  })
])

export type RuntimeEnvelope = z.infer<typeof runtimeEnvelopeSchema>

export function parseRuntimeEnvelope(value: unknown): RuntimeEnvelope {
  return runtimeEnvelopeSchema.parse(value)
}
