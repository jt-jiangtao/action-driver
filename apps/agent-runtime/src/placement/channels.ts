import { z } from 'zod'
import type { Json, PluginOwner } from '@action-driver/plugin-contracts'
import { PlacementError } from './hosts'
import type { HostChannel, InvocationContextDto } from './invoker'

const ownerSchema = z.object({ pluginId: z.string().min(1), version: z.string().min(1), hostEpoch: z.string().min(1) }).strict()
const contextSchema = z
  .object({
    requestId: z.string().min(1).max(256),
    callId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256).optional(),
    sessionId: z.string().min(1).max(256).optional(),
    deadline: z.number().int(),
    grants: z.array(z.string().min(1).max(256)).max(64)
  })
  .strict()

/** What a host needs to run one call; the payload is the tool input, never a local path. */
export const hostInvokeRequestSchema = z
  .object({
    owner: ownerSchema,
    toolId: z.string().min(1).max(256),
    payload: z.json(),
    context: contextSchema
  })
  .strict()
export type HostInvokeRequest = z.infer<typeof hostInvokeRequestSchema>

export const hostCancelRequestSchema = z.object({ owner: ownerSchema, callId: z.string().min(1).max(256) }).strict()
export type HostCancelRequest = z.infer<typeof hostCancelRequestSchema>

export interface LocalSkillBinding {
  skillId: string
  contractVersion: number
  /** Maps a tool id to the skill input this host exposes for it. */
  input?(payload: Json, context: InvocationContextDto): Json
}

/**
 * Runs a call on this process's own skill providers. It is the local/UI host channel: the plugin
 * owner and the caller's context arrive over the handshake boundary, not from the URI or payload.
 */
export function createLocalSkillChannel(options: {
  resolve(skillId: string, contractVersion: number): { execute(request: { invocationId: string; input: unknown }, signal?: AbortSignal): Promise<{ ok: true; providerId: string; input: unknown; needsUser?: boolean }> }
  bindings: Record<string, LocalSkillBinding>
}): HostChannel {
  return {
    async invoke(input): Promise<Json> {
      const binding = options.bindings[input.toolId]
      if (!binding) throw new PlacementError('PLACEMENT_UNAVAILABLE', `${input.toolId} is not served by this host`)
      const provider = options.resolve(binding.skillId, binding.contractVersion)
      const result = await provider.execute(
        { invocationId: input.context.callId, input: binding.input ? binding.input(input.payload, input.context) : input.payload },
        input.signal
      )
      return z.json().parse(result.input)
    },
    async cancel(): Promise<void> {
      // Skill providers observe cancellation through the call signal; nothing else to confirm yet.
    }
  }
}

const responseSchema = z.object({ ok: z.boolean(), value: z.json().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() }).strict()

/**
 * Talks to another Action-Driver runtime's placement surface. The pinned owner travels with every
 * call so the remote host can reject a call that names a different plugin version than it serves.
 */
export function createHttpHostChannel(options: { baseUrl: string; token: string; fetch?: typeof fetch }): HostChannel {
  const fetchImpl = options.fetch ?? fetch
  const post = async (path: string, body: unknown, signal: AbortSignal): Promise<z.infer<typeof responseSchema>> => {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    const parsed = responseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new PlacementError('PLACEMENT_UNAVAILABLE', `${path} returned an unreadable response (${response.status})`)
    if (!parsed.data.ok) throw errorOf(parsed.data.error)
    return parsed.data
  }
  return {
    async invoke(input): Promise<Json> {
      // The signal is transport state, not call data: only the pinned owner, tool and minimal
      // context cross the wire.
      const response = await post('/placement/invoke', {
        owner: input.owner,
        toolId: input.toolId,
        payload: input.payload,
        context: input.context
      }, input.signal)
      return response.value ?? null
    },
    async cancel(owner: PluginOwner, callId: string, signal: AbortSignal): Promise<void> {
      await post('/placement/cancel', { owner, callId }, signal)
    }
  }
}

function errorOf(error: { code: string; message: string } | undefined): Error {
  const code = error?.code ?? 'PLACEMENT_UNAVAILABLE'
  const message = error?.message ?? 'remote host refused the call'
  if ((['PLACEMENT_NO_HOST', 'PLACEMENT_DEVICE_MISSING', 'PLACEMENT_WORKSPACE_MISSING', 'PLACEMENT_TARGET_MISMATCH', 'PLACEMENT_UNAVAILABLE', 'PLACEMENT_STALE_INSTANCE', 'PLACEMENT_RESULT_UNKNOWN'] as readonly string[]).includes(code)) {
    return new PlacementError(code as never, message)
  }
  return Object.assign(new Error(message), { code })
}
