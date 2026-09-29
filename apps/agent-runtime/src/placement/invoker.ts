import type { Json, PluginOwner } from '@actiondriver/plugin-contracts'
import type { HostRegistry} from './hosts';
import { PlacementError, type PlacementAuditEntry, type RegisteredHost } from './hosts'
import { selectHost, type PlacementRequest } from './selector'

/** The channel a host exposes for one fixed instance; the runtime never talks to a host by name. */
export interface HostChannel {
  invoke(input: { owner: PluginOwner; toolId: string; payload: Json; context: InvocationContextDto; signal: AbortSignal }): Promise<Json>
  /** Optional host-side confirmation that the call is actually finished. */
  cancel?(owner: PluginOwner, callId: string, signal: AbortSignal): Promise<void>
}

/** Minimal context crossing to another host: identity, deadline and grants, nothing more. */
export interface InvocationContextDto {
  requestId: string
  callId: string
  taskId?: string
  sessionId?: string
  deadline: number
  grants: readonly string[]
}

export interface InvokerOptions {
  registry: HostRegistry
  /** Resolves the live channel for a connected host instance, or null once it is gone. */
  channel(host: RegisteredHost): HostChannel | null
  now(): number
  audit?(entry: PlacementAuditEntry): void
}

export class PlacementInvoker {
  constructor(private readonly options: InvokerOptions) {}

  /**
   * Runs one capability call on the host selected at the start of the call. The instance and plugin
   * version are pinned: a disconnect, a superseded instance or a lost confirmation yields a real
   * outcome code and never a silent replay on another host.
   */
  async invoke(request: PlacementRequest, payload: Json, call: { requestId: string; callId: string; taskId?: string; sessionId?: string; deadline: number; signal: AbortSignal }): Promise<Json> {
    const decision = selectHost(this.options.registry, request, { now: this.options.now, ...(this.options.audit ? { audit: this.options.audit } : {}) })
    const pinned = decision.host
    const owner: PluginOwner = { pluginId: request.plugin.id, version: request.plugin.version, hostEpoch: `${pinned.hostId}:${pinned.instanceId}` }
    const channel = this.options.channel(pinned)
    if (!channel) throw new PlacementError('PLACEMENT_UNAVAILABLE', `${pinned.hostId}/${pinned.instanceId} has no channel`)

    // The deadline travels with the call: a host that never answers must not keep the turn open.
    const expiry = new AbortController()
    const timer = setTimeout(() => expiry.abort(new DOMException('deadline exceeded', 'TimeoutError')), Math.max(1, call.deadline - this.options.now()))
    const signal = AbortSignal.any([call.signal, expiry.signal])
    const onAbort = () => { void this.cancel(pinned, owner, call) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      // Re-check right before dispatch: a lease that expired during selection must not be used.
      this.options.registry.assertCurrent(pinned.hostId, pinned.instanceId)
      const result = await channel.invoke({
        owner,
        toolId: request.toolId,
        payload,
        context: {
          requestId: call.requestId,
          callId: call.callId,
          ...(call.taskId ? { taskId: call.taskId } : {}),
          ...(call.sessionId ? { sessionId: call.sessionId } : {}),
          deadline: call.deadline,
          grants: request.grants
        },
        signal
      })
      // A result that arrives after the instance was replaced belongs to the old epoch and must
      // never be attributed to the host that superseded it.
      this.options.registry.assertCurrent(pinned.hostId, pinned.instanceId)
      return result
    } catch (error) {
      if (error instanceof PlacementError) throw error
      if (this.options.registry.isSuperseded(pinned.hostId, pinned.instanceId)) {
        throw new PlacementError('PLACEMENT_STALE_INSTANCE', `${pinned.hostId}/${pinned.instanceId} was replaced while the call was running`)
      }
      if (signal.aborted) {
        // Cancellation is only confirmed once the host acknowledged it; otherwise the side effect
        // may still run remotely and the outcome is unknown.
        const reason = call.signal.aborted ? 'was cancelled' : 'hit its deadline'
        throw new PlacementError('PLACEMENT_RESULT_UNKNOWN', `${call.callId} ${reason} but ${pinned.hostId} did not confirm the final state`)
      }
      if (!this.options.registry.get(pinned.hostId) || this.options.registry.get(pinned.hostId)?.instanceId !== pinned.instanceId) {
        throw new PlacementError('PLACEMENT_RESULT_UNKNOWN', `${pinned.hostId} disconnected before confirming ${call.callId}`)
      }
      // A live host answered with an error: that is a real, attributable result.
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** Sends cancellation to the pinned instance; the caller learns whether the host confirmed it. */
  private async cancel(host: RegisteredHost, owner: PluginOwner, call: { callId: string; deadline: number; signal: AbortSignal }): Promise<void> {
    const channel = this.options.channel(host)
    if (!channel?.cancel) return
    // Cancellation gets its own short window; it must not reuse the aborted call signal.
    const window = AbortSignal.timeout(Math.max(1, Math.min(5_000, call.deadline - this.options.now())))
    await channel.cancel(owner, call.callId, window).catch(() => undefined)
  }
}
