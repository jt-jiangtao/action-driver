import type { Json, PlacementDeclaration, PlacementLocation } from '@action-driver/plugin-contracts'
import { createHttpHostChannel, createLocalSkillChannel, type HostInvokeRequest, type LocalSkillBinding } from './channels'
import { HostRegistry, PlacementError, type PlacementAuditEntry, type RegisteredHost } from './hosts'
import { PlacementInvoker, type HostChannel, type InvocationContextDto } from './invoker'
import type { PlacementRoutesPort } from './routes'
import type { PlacementRequest } from './selector'

export interface LocalHostOptions {
  hostId: string
  instanceId: string
  kind: PlacementLocation
  /** Tool-id namespace this process serves; derived from `tools` when omitted. */
  target?: 'local' | 'cloud'
  devices: readonly string[]
  workspace: string
  tools: readonly string[]
  plugins: readonly { id: string; version: string }[]
  bindings: Record<string, LocalSkillBinding>
  resolve(skillId: string, contractVersion: number): { execute(request: { invocationId: string; input: unknown }, signal?: AbortSignal): Promise<{ ok: true; providerId: string; input: unknown }> }
}

export interface RemoteHostOptions {
  /** Optional label; the peer's own host identity from discovery always wins. */
  hostId?: string
  baseUrl: string
  token: string
  fetch?: typeof fetch
  /** Optional overrides; the peer's own advertised identity and inventory are the default. */
  kind?: PlacementLocation
  target?: 'local' | 'cloud'
  tools?: readonly string[]
  devices?: readonly string[]
  workspace?: string
  plugins?: readonly { id: string; version: string }[]
}

export interface PlacementInvocation {
  toolId: string
  payload: Json
  plugin: { id: string; version: string }
  declaration?: PlacementDeclaration
  grants: readonly string[]
  hint?: PlacementLocation
  requestId: string
  callId: string
  taskId?: string
  sessionId?: string
  deadline: number
  signal: AbortSignal
}

export type PlacementOutcome =
  | { placed: false; reason: 'local-only' }
  | { placed: true; value: Json; hostId: string; instanceId: string; location: PlacementLocation }

/**
 * Connects the placement contract to real channels. Legacy tools stay on the existing local path:
 * `invoke` only places a call when a non-local host actually serves the tool, so an undeclared
 * plugin that always ran here keeps running here.
 */
export class PlacementRouter {
  readonly hosts: HostRegistry
  private readonly channels = new Map<string, HostChannel>()
  private readonly auditLog: PlacementAuditEntry[] = []
  private readonly invoker: PlacementInvoker
  private localChannel: HostChannel | null = null
  private localHost: RegisteredHost | null = null

  constructor(private readonly options: { now?: () => number; auditLimit?: number } = {}) {
    const now = this.options.now ?? Date.now
    this.hosts = new HostRegistry({ now, audit: entry => this.record(entry) })
    this.invoker = new PlacementInvoker({
      registry: this.hosts,
      channel: host => this.channels.get(placeholder(host)) ?? null,
      now,
      audit: entry => this.record(entry)
    })
  }

  now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** Registers this runtime's own process as a host and exposes it as a channel. */
  registerLocalHost(options: LocalHostOptions): RegisteredHost {
    const { bindings, resolve, ...handshake } = options
    // A runtime that only serves cloud tools is a cloud host; everything else keeps the local
    // namespace, so the tool-id boundary stays a property of the inventory rather than a label.
    const target = options.target ?? (options.tools.length > 0 && options.tools.every(tool => tool.startsWith('tools/cloud/')) ? 'cloud' : 'local')
    const host = this.hosts.connect({ protocol: 1, ...handshake, target })
    this.localHost = host
    this.localChannel = createLocalSkillChannel({ resolve, bindings })
    this.channels.set(placeholder(host), this.localChannel)
    return host
  }

  /** Attaches the executable channel for a host registered through this router. */
  attachChannel(host: RegisteredHost, channel: HostChannel): void {
    this.channels.set(placeholder(host), channel)
  }

  /**
   * Connects a remote runtime as a host. The peer's own identity and inventory are adopted from its
   * `/placement/hosts` self record, so a call is pinned to the instance the host itself reports and
   * never to an id this process invented.
   */
  async connectRemoteHost(options: RemoteHostOptions): Promise<RegisteredHost> {
    const label = options.hostId ?? options.baseUrl
    const fetchImpl = options.fetch ?? fetch
    const channel = createHttpHostChannel({ baseUrl: options.baseUrl, token: options.token, fetch: fetchImpl })
    const discovery = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/placement/hosts`, {
      headers: { authorization: `Bearer ${options.token}` }
    })
    if (!discovery.ok) throw new PlacementError('PLACEMENT_UNAVAILABLE', `${label} refused discovery (${discovery.status})`)
    const body = (await discovery.json()) as { value?: { self?: unknown } }
    const advertised = peerHost(body.value?.self)
    if (!advertised) throw new PlacementError('PLACEMENT_UNAVAILABLE', `${label} reported no host of its own`)
    const handshake = {
      protocol: 1,
      hostId: options.hostId || advertised.hostId,
      instanceId: advertised.instanceId,
      kind: options.kind ?? advertised.kind,
      target: options.target ?? advertised.target,
      devices: [...(options.devices ?? advertised.devices)],
      workspace: options.workspace ?? advertised.workspace,
      tools: [...(options.tools ?? advertised.tools)],
      plugins: [...(options.plugins ?? advertised.plugins)]
    }
    const host = this.hosts.connect(handshake)
    this.channels.set(placeholder(host), channel)
    return host
  }

  disconnect(hostId: string, instanceId: string): void {
    this.hosts.disconnect(hostId, instanceId)
    this.channels.delete(`${hostId}:${instanceId}`)
  }

  /**
   * Places a call when another host owns the tool. `local-only` means "run it the way this runtime
   * always has": no declaration asked for another location and no remote host serves that tool.
   */
  async invoke(call: PlacementInvocation): Promise<PlacementOutcome> {
    const request: PlacementRequest = {
      plugin: call.plugin,
      ...(call.declaration ? { declaration: call.declaration } : {}),
      toolId: call.toolId,
      grants: call.grants,
      ...(call.hint ? { hint: call.hint } : {})
    }
    if (this.isLocalOnly(request)) return { placed: false, reason: 'local-only' }
    const placed = await this.invoker.invoke(request, call.payload, {
      requestId: call.requestId,
      callId: call.callId,
      ...(call.taskId ? { taskId: call.taskId } : {}),
      ...(call.sessionId ? { sessionId: call.sessionId } : {}),
      deadline: call.deadline,
      signal: call.signal
    })
    return { placed: true, value: placed.value, hostId: placed.host.hostId, instanceId: placed.host.instanceId, location: placed.location }
  }

  /**
   * A call only leaves this process when the plugin declares another location or a non-local host
   * actually serves the tool. Everything else keeps the legacy in-process path.
   */
  private isLocalOnly(request: PlacementRequest): boolean {
    const candidates = this.hosts.list().filter(host => host.tools.includes(request.toolId))
    const nonLocal = candidates.some(host => host.kind !== 'ui' && host.kind !== 'local-workspace')
    const declaredRemote = request.declaration?.locations.some(location => location === 'remote-workspace' || location === 'cloud') ?? false
    return !nonLocal && !declaredRemote
  }

  /** Route surface used when this runtime acts as a host for another runtime. */
  routes(): PlacementRoutesPort {
    const running = new Map<string, { controller: AbortController; settled: Promise<unknown> }>()
    return {
      connect: input => this.hosts.connect(input),
      disconnect: (hostId, instanceId) => this.disconnect(hostId, instanceId),
      hosts: () => this.hosts.list(),
      audit: () => [...this.auditLog],
      self: () => this.localHost,
      execute: async (request: HostInvokeRequest, signal: AbortSignal) => {
        // This process is the host: a call only runs when it names this very instance, so a call
        // pinned to a superseded instance is refused instead of being attributed to the new one.
        if (!this.localHost) throw new PlacementError('PLACEMENT_UNAVAILABLE', 'this runtime registered no local host')
        if (request.owner.hostEpoch !== `${this.localHost.hostId}:${this.localHost.instanceId}`) {
          throw new PlacementError('PLACEMENT_STALE_INSTANCE', `${request.owner.hostEpoch} is not the current instance of this host`)
        }
        if (!this.localChannel) throw new PlacementError('PLACEMENT_UNAVAILABLE', 'this runtime registered no local channel')
        const controller = new AbortController()
        const combined = AbortSignal.any([signal, controller.signal])
        const invocation = this.localChannel.invoke({
          owner: request.owner,
          toolId: request.toolId,
          payload: request.payload,
          context: request.context as InvocationContextDto,
          signal: combined
        })
        running.set(request.context.callId, { controller, settled: invocation.catch(() => undefined) })
        try {
          return await invocation
        } finally {
          running.delete(request.context.callId)
        }
      },
      cancel: async ({ callId }) => {
        const call = running.get(callId)
        if (!call) return { acknowledged: false }
        call.controller.abort(new DOMException('cancelled', 'AbortError'))
        // Only an actually finished call is acknowledged; otherwise the caller records the
        // side-effect outcome as unknown instead of assuming the cancellation took effect.
        const settled = await Promise.race([call.settled.then(() => true), delay(1_000).then(() => false)])
        return { acknowledged: settled }
      }
    }
  }

  audit(): PlacementAuditEntry[] {
    return [...this.auditLog]
  }

  private record(entry: PlacementAuditEntry): void {
    this.auditLog.push(entry)
    const limit = this.options.auditLimit ?? 500
    if (this.auditLog.length > limit) this.auditLog.splice(0, this.auditLog.length - limit)
  }
}

function placeholder(host: { hostId: string; instanceId: string }): string {
  return `${host.hostId}:${host.instanceId}`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const PLACEMENT_HOSTS_ENV = 'ACTION_DRIVER_PLACEMENT_HOSTS'

export interface RemoteHostDeclaration {
  hostId?: string
  baseUrl: string
  token: string
  kind?: PlacementLocation
  target?: 'local' | 'cloud'
  tools?: readonly string[]
  plugins?: readonly { id: string; version: string }[]
}

/**
 * Remote placement hosts are declared by configuration, never guessed from a tool id. A malformed
 * declaration is a hard error so a typo cannot silently turn a configured host into "unavailable",
 * while an unreachable host is reported and simply withdraws its new-call entry point.
 */
export function parseRemoteHostDeclarations(environment: NodeJS.ProcessEnv): RemoteHostDeclaration[] {
  const raw = environment[PLACEMENT_HOSTS_ENV]?.trim()
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${PLACEMENT_HOSTS_ENV} must be valid JSON`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${PLACEMENT_HOSTS_ENV} must be a JSON array`)
  return parsed.map(entry => {
    const host = entry as Partial<RemoteHostDeclaration>
    if (typeof host.baseUrl !== 'string' || !/^https?:\/\//.test(host.baseUrl)) throw new Error(`${PLACEMENT_HOSTS_ENV}: each host needs an http(s) baseUrl`)
    if (typeof host.token !== 'string' || !host.token) throw new Error(`${PLACEMENT_HOSTS_ENV}: each host needs a token`)
    if (host.hostId !== undefined && typeof host.hostId !== 'string') throw new Error(`${PLACEMENT_HOSTS_ENV}: hostId must be a string`)
    return {
      baseUrl: host.baseUrl,
      token: host.token,
      ...(host.hostId ? { hostId: host.hostId } : {}),
      ...(host.kind ? { kind: host.kind } : {}),
      ...(host.target ? { target: host.target } : {}),
      ...(host.tools ? { tools: host.tools } : {}),
      ...(host.plugins ? { plugins: host.plugins } : {})
    }
  })
}

/** Reads a peer's own host record defensively: discovery must never hand us a malformed pin. */
function peerHost(value: unknown): { hostId: string; instanceId: string; kind: PlacementLocation; target: 'local' | 'cloud'; devices: string[]; workspace: string; tools: string[]; plugins: { id: string; version: string }[] } | null {
  if (!value || typeof value !== 'object') return null
  const host = value as Record<string, unknown>
  if (typeof host.hostId !== 'string' || typeof host.instanceId !== 'string') return null
  if (typeof host.kind !== 'string' || typeof host.target !== 'string') return null
  return {
    hostId: host.hostId,
    instanceId: host.instanceId,
    kind: host.kind as PlacementLocation,
    target: host.target === 'cloud' ? 'cloud' : 'local',
    devices: Array.isArray(host.devices) ? host.devices.filter((device): device is string => typeof device === 'string') : [],
    workspace: typeof host.workspace === 'string' ? host.workspace : 'none',
    tools: Array.isArray(host.tools) ? host.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    plugins: Array.isArray(host.plugins)
      ? host.plugins.flatMap(plugin => (plugin && typeof plugin === 'object' && typeof (plugin as { id?: unknown }).id === 'string' && typeof (plugin as { version?: unknown }).version === 'string'
        ? [{ id: (plugin as { id: string }).id, version: (plugin as { version: string }).version }]
        : []))
      : []
  }
}
