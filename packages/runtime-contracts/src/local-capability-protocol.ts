import { z } from 'zod'
import type { SkillExecutionEvent } from '@actiondriver/contracts'

export const LOCAL_CAPABILITY_PATH = '/capabilities'
export const LOCAL_CAPABILITY_PROTOCOL = 'actiondriver.local-capabilities.v1'

const provider = z.object({
  providerId: z.string().min(1),
  providerVersion: z.string().min(1),
  skillId: z.string().min(1),
  contractVersion: z.number().int().positive()
}).strict()

export const localCapabilityFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('register'), providers: z.array(provider) }).strict(),
  z.object({ type: z.literal('registered'), providerCount: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal('invoke'), invocationId: z.string().min(1),
    providerId: z.string().min(1), providerVersion: z.string().min(1),
    skillId: z.string().min(1), deadlineUnixMs: z.number().int(), input: z.unknown()
  }).strict(),
  z.object({ type: z.literal('cancel'), invocationId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('result'), invocationId: z.string().min(1), output: z.unknown().optional() }).strict(),
  z.object({
    type: z.literal('error'), invocationId: z.string().min(1),
    code: z.enum(['CAPABILITY_UNAVAILABLE', 'SKILL_TIMEOUT', 'SKILL_PROVIDER_FAILED']),
    message: z.string()
  }).strict()
])

export type LocalCapabilityFrame = z.infer<typeof localCapabilityFrame>
export type LocalCapabilityProvider = z.infer<typeof provider>

export type SkillExecuteRequest = {
  invocationId: string
  requestedSkillId: string
  resolvedProviderId: string
  providerVersion: string
  input: unknown
}

export type SkillExecuteResult = { event: SkillExecutionEvent; output?: unknown }
