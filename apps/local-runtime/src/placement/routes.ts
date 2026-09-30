import type { Hono } from 'hono'
import { failure, success } from '../service/http/http-contract'
import { mapErrorToResponse } from '../service/http/http-errors'
import { hostCancelRequestSchema, hostInvokeRequestSchema, type HostInvokeRequest } from './channels'
import { PlacementError, remainingMs, type PlacementAuditEntry, type RegisteredHost } from './hosts'

export interface PlacementRoutesPort {
  connect(input: unknown): RegisteredHost
  disconnect(hostId: string, instanceId: string): void
  hosts(): RegisteredHost[]
  audit(): PlacementAuditEntry[]
  /** Executes a call this runtime was placed into as a host. */
  execute(request: HostInvokeRequest, signal: AbortSignal): Promise<unknown>
  /** Aborts a call this host is running; only a settled call is acknowledged. */
  cancel(request: { callId: string }): Promise<{ acknowledged: boolean }>
  /** This runtime's own host record (identity plus inventory), so a caller can pin it exactly. */
  self(): RegisteredHost | null
}

/**
 * The placement surface a host exposes. A remote runtime handshakes here, reports its plugin and
 * tool inventory, and later receives pinned calls; the host never learns anything about the caller
 * beyond the minimal context the call carries.
 */
export function registerPlacementRoutes(app: Hono, port: PlacementRoutesPort): void {
  app.onError((error, context) => {
    const mapped = mapErrorToResponse(error)
    return context.json(failure(mapped.code, mapped.message), mapped.status)
  })

  app.get('/placement/hosts', context =>
    context.json(success({ self: port.self(), hosts: port.hosts(), audit: port.audit() }))
  )

  app.post('/placement/handshake', async context => {
    const host = port.connect(await context.req.json())
    return context.json(success({ hostId: host.hostId, instanceId: host.instanceId, instance: host.instance }))
  })

  app.post('/placement/disconnect', async context => {
    const body = (await context.req.json()) as { hostId?: unknown; instanceId?: unknown }
    if (typeof body.hostId !== 'string' || typeof body.instanceId !== 'string') {
      throw new PlacementError('PLACEMENT_UNAVAILABLE', 'hostId and instanceId are required')
    }
    port.disconnect(body.hostId, body.instanceId)
    return context.json(success({ disconnected: true }))
  })

  app.post('/placement/invoke', async context => {
    const request = hostInvokeRequestSchema.parse(await context.req.json())
    if (request.context.deadline <= Date.now()) throw new PlacementError('PLACEMENT_RESULT_UNKNOWN', `${request.context.callId} arrived past its deadline`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('deadline exceeded', 'TimeoutError')), remainingMs(request.context.deadline))
    try {
      const value = await port.execute(request, controller.signal)
      return context.json(success(value))
    } finally {
      clearTimeout(timer)
    }
  })

  app.post('/placement/cancel', async context => {
    const request = hostCancelRequestSchema.parse(await context.req.json())
    // Cancellation is acknowledged only after the host's call actually settled; the caller treats a
    // missing confirmation as an unknown outcome.
    return context.json(success(await port.cancel({ callId: request.callId })))
  })
}
