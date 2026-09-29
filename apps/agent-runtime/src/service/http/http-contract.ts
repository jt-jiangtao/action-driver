import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { ModelFailureCode } from '@actiondriver/model-connections'
import type { AgentFileErrorCode } from '@actiondriver/runtime-contracts'

export type Envelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ModelFailureCode | AgentFileErrorCode | string; message: string } }

export const id = z.string().trim().min(1)

export const enabledSchema = z.object({ enabled: z.boolean() }).strict()

export function success<T>(value: T): Envelope<T> {
  return { ok: true, value }
}

export function failure(
  code: ModelFailureCode | AgentFileErrorCode | string,
  message: string
): Envelope<never> {
  return { ok: false, error: { code, message } }
}

export function invalid(): Envelope<never> {
  return failure('invalid-request', 'Request body does not match the route schema')
}

export function validate<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, (result, context) => {
    if (!result.success) return context.json(invalid(), 400)
  })
}
