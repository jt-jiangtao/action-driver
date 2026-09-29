import { z } from 'zod'
import {
  PLACEMENT_DEVICES,
  PLACEMENT_LOCATIONS,
  PLACEMENT_PROTOCOL_VERSION,
  PLACEMENT_WORKSPACE_REQUIREMENTS,
  type PlacementLocation
} from '@actiondriver/plugin-contracts'

export const PLACEMENT_ERROR_CODES = [
  'PLACEMENT_NO_HOST',
  'PLACEMENT_DEVICE_MISSING',
  'PLACEMENT_WORKSPACE_MISSING',
  'PLACEMENT_TARGET_MISMATCH',
  'PLACEMENT_PROTOCOL_UNSUPPORTED',
  'PLACEMENT_STALE_INSTANCE',
  'PLACEMENT_UNAVAILABLE',
  'PLACEMENT_RESULT_UNKNOWN'
] as const
export type PlacementErrorCode = (typeof PLACEMENT_ERROR_CODES)[number]

export class PlacementError extends Error {
  constructor(readonly code: PlacementErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'PlacementError'
  }
}

/**
 * Deadlines in this contract are wall-clock milliseconds. Timer APIs cap out well below that, so a
 * far-future (or already passed) deadline is clamped instead of overflowing into an instant fire.
 */
export const MAX_TIMER_MS = 2_147_483_647

export function remainingMs(deadline: number): number {
  return Math.min(Math.max(1, deadline - Date.now()), MAX_TIMER_MS)
}

const handshakeSchema = z
  .object({
    protocol: z.number().int().positive(),
    hostId: z.string().min(1).max(128),
    instanceId: z.string().min(1).max(128),
    kind: z.enum(PLACEMENT_LOCATIONS),
    /** `local` or `cloud`: the tool-id namespace this host is allowed to execute. */
    target: z.enum(['local', 'cloud']),
    devices: z.array(z.enum(PLACEMENT_DEVICES)).default([]),
    workspace: z.enum(PLACEMENT_WORKSPACE_REQUIREMENTS).default('none'),
    tools: z.array(z.string().min(1)).default([]),
    plugins: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) }).strict()).default([])
  })
  .strict()
export type PlacementHandshake = z.infer<typeof handshakeSchema>

function pluginList(plugins: readonly { id: string; version: string }[]): string {
  return plugins.map(plugin => `${plugin.id}@${plugin.version}`).sort().join(',')
}

export interface RegisteredHost extends PlacementHandshake {
  instance: number
  connectedAt: number
}

export interface PlacementAuditEntry {
  kind: 'host.connected' | 'host.disconnected' | 'host.superseded' | 'host.updated' | 'placement.selected' | 'placement.refused'
  at: number
  hostId?: string
  instanceId?: string
  location?: PlacementLocation
  pluginId?: string
  pluginVersion?: string
  toolId?: string
  detail?: string
}

/**
 * Versioned host directory. A host is only usable after an accepted handshake, and a superseded
 * instance is kept as a tombstone so a late message from the old epoch is rejected instead of
 * being attributed to the host that replaced it.
 */
export class HostRegistry {
  private readonly hosts = new Map<string, RegisteredHost>()
  private readonly superseded = new Map<string, Set<string>>()
  private sequence = 0

  constructor(
    private readonly options: {
      supportedProtocols?: readonly number[]
      now(): number
      audit?(entry: PlacementAuditEntry): void
    }
  ) {}

  connect(input: unknown): RegisteredHost {
    const handshake = handshakeSchema.parse(input)
    const protocols = this.options.supportedProtocols ?? [PLACEMENT_PROTOCOL_VERSION]
    if (!protocols.includes(handshake.protocol)) {
      throw new PlacementError('PLACEMENT_PROTOCOL_UNSUPPORTED', `${handshake.hostId} speaks placement protocol ${handshake.protocol}; host supports ${protocols.join(',')}`)
    }
    // One host advertising two versions of the same plugin would publish the contribution twice.
    const publishedPlugins = new Set<string>()
    for (const plugin of handshake.plugins) {
      if (publishedPlugins.has(plugin.id)) throw new PlacementError('PLACEMENT_UNAVAILABLE', `${handshake.hostId} declares ${plugin.id} more than once`)
      publishedPlugins.add(plugin.id)
    }
    const previous = this.hosts.get(handshake.hostId)
    if (previous && previous.instanceId !== handshake.instanceId) {
      // The previous instance must never publish again; keep it only as a rejection tombstone.
      const tombstones = this.superseded.get(handshake.hostId) ?? new Set<string>()
      tombstones.add(previous.instanceId)
      this.superseded.set(handshake.hostId, tombstones)
      this.options.audit?.({ kind: 'host.superseded', at: this.options.now(), hostId: handshake.hostId, instanceId: previous.instanceId, detail: `replaced by ${handshake.instanceId}` })
    }
    // A re-handshake on the same instance is how an upgrade or a plugin stop is reported.
    const wasInstalled = previous?.instanceId === handshake.instanceId ? pluginList(previous.plugins) : null
    const nowInstalled = pluginList(handshake.plugins)
    const host: RegisteredHost = { ...handshake, instance: ++this.sequence, connectedAt: this.options.now() }
    this.hosts.set(handshake.hostId, host)
    this.options.audit?.({ kind: 'host.connected', at: host.connectedAt, hostId: host.hostId, instanceId: host.instanceId, location: host.kind })
    if (wasInstalled !== null && wasInstalled !== nowInstalled) {
      this.options.audit?.({ kind: 'host.updated', at: this.options.now(), hostId: host.hostId, instanceId: host.instanceId, detail: `${wasInstalled} -> ${nowInstalled}` })
    }
    return host
  }

  /** Withdraws the host's new-call entry point; an already running call keeps its own binding. */
  disconnect(hostId: string, instanceId: string): void {
    const host = this.hosts.get(hostId)
    if (!host) return
    if (host.instanceId !== instanceId) {
      const tombstones = this.superseded.get(hostId) ?? new Set<string>()
      tombstones.add(instanceId)
      this.superseded.set(hostId, tombstones)
      return
    }
    this.hosts.delete(hostId)
    this.options.audit?.({ kind: 'host.disconnected', at: this.options.now(), hostId, instanceId })
  }

  /** A superseded instance must not publish results, even if it is still connected on its socket. */
  assertCurrent(hostId: string, instanceId: string): RegisteredHost {
    const host = this.hosts.get(hostId)
    if (!host || host.instanceId !== instanceId) {
      throw new PlacementError('PLACEMENT_STALE_INSTANCE', `${hostId}/${instanceId} is no longer the current instance`)
    }
    return host
  }

  isSuperseded(hostId: string, instanceId: string): boolean {
    return this.superseded.get(hostId)?.has(instanceId) ?? false
  }

  list(): RegisteredHost[] {
    return [...this.hosts.values()].sort((left, right) => left.instance - right.instance)
  }

  get(hostId: string): RegisteredHost | undefined {
    return this.hosts.get(hostId)
  }
}
