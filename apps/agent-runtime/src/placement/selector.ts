import { declaredDevices, supportsLocation, type PlacementDeclaration, type PlacementLocation } from '@actiondriver/plugin-contracts'
import type { HostRegistry} from './hosts';
import { PlacementError, type PlacementAuditEntry, type RegisteredHost } from './hosts'

/** Location a `local` tool may run in; the cloud namespace is kept strictly separate. */
const LOCAL_LOCATIONS: readonly PlacementLocation[] = ['ui', 'local-workspace']
const CLOUD_LOCATIONS: readonly PlacementLocation[] = ['remote-workspace', 'cloud']

export interface PlacementRequest {
  plugin: { id: string; version: string }
  /** Manifest declaration; `undefined` keeps legacy plugins working on any host. */
  declaration?: PlacementDeclaration
  toolId: string
  grants: readonly string[]
  /** Caller preference (for example "stay in the UI when it can"); never widens authorization. */
  hint?: PlacementLocation
  requiredDevices?: readonly string[]
}

export interface PlacementDecision {
  host: RegisteredHost
  location: PlacementLocation
  reason: string
}

function targetOf(toolId: string): 'local' | 'cloud' | null {
  if (toolId.startsWith('tools/local/')) return 'local'
  if (toolId.startsWith('tools/cloud/')) return 'cloud'
  return null
}

function missingDevice(host: RegisteredHost, request: PlacementRequest): string | null {
  const required = [...declaredDevices(request.declaration), ...(request.requiredDevices ?? [])]
  for (const device of required) if (!host.devices.includes(device as never)) return device
  return null
}

/**
 * Picks exactly one host for a capability call. Everything that must hold is checked here: protocol,
 * online instance, declared location, device/workspace requirements, installed plugin version, the
 * tool-id target and the caller's grants. The decision (and the refusal reason) is auditable.
 */
export function selectHost(
  registry: HostRegistry,
  request: PlacementRequest,
  options: { now(): number; audit?(entry: PlacementAuditEntry): void }
): PlacementDecision {
  const target = targetOf(request.toolId)
  if (target === null) throw new PlacementError('PLACEMENT_TARGET_MISMATCH', `${request.toolId} is neither a local nor a cloud tool`)
  // A grant is per tool id, so a local grant can never authorize the cloud tool of the same name.
  // Grants are persisted as `<toolId>@<version>`; only that exact tool id counts.
  if (!request.grants.some(grant => grant === request.toolId || grant.startsWith(`${request.toolId}@`))) {
    throw new PlacementError('PLACEMENT_TARGET_MISMATCH', `${request.toolId} is not granted to this call`)
  }

  const candidates: RegisteredHost[] = []
  let refusedForDevice: string | null = null
  let refusedForWorkspace: RegisteredHost | null = null
  let refusedForLocation = false
  for (const host of registry.list()) {
    if (host.target !== target) continue
    const allowed = target === 'local' ? LOCAL_LOCATIONS : CLOUD_LOCATIONS
    if (!allowed.includes(host.kind)) continue
    if (!supportsLocation(request.declaration, host.kind)) {
      refusedForLocation = true
      continue
    }
    if (!host.tools.includes(request.toolId)) continue
    // The installed plugin version is pinned per call: a host that upgraded (or stopped) the
    // plugin must not silently serve a different version than the caller asked for.
    if (!host.plugins.some(plugin => plugin.id === request.plugin.id && plugin.version === request.plugin.version)) continue
    const device = missingDevice(host, request)
    if (device) {
      refusedForDevice ??= device
      continue
    }
    const workspace = request.declaration?.workspace ?? 'none'
    if (workspace !== 'none' && host.workspace !== workspace && host.workspace !== 'session-workspace') {
      refusedForWorkspace ??= host
      continue
    }
    candidates.push(host)
  }

  const preferred = request.hint ?? request.declaration?.preferred
  const chosen = (preferred && candidates.find(host => host.kind === preferred)) ?? candidates[0]
  if (!chosen) {
    const missing = [...declaredDevices(request.declaration), ...(request.requiredDevices ?? [])]
    const code = refusedForDevice !== null ? 'PLACEMENT_DEVICE_MISSING' : refusedForWorkspace !== null ? 'PLACEMENT_WORKSPACE_MISSING' : 'PLACEMENT_NO_HOST'
    const detail = refusedForDevice !== null
      ? `${request.plugin.id} needs device ${refusedForDevice}`
      : missing.length > 0
        ? `${request.plugin.id} needs devices ${missing.join(', ')} and no connected host provides them`
        : refusedForLocation
          ? `${request.plugin.id} does not declare a location this ${target} call may use`
          : `no connected ${target} host serves ${request.toolId} for ${request.plugin.id}@${request.plugin.version}`
    options.audit?.({ kind: 'placement.refused', at: options.now(), pluginId: request.plugin.id, pluginVersion: request.plugin.version, toolId: request.toolId, detail })
    throw new PlacementError(code, detail)
  }
  const reason = preferred && chosen.kind === preferred ? `preferred ${preferred}` : `first eligible ${chosen.kind} host`
  options.audit?.({
    kind: 'placement.selected',
    at: options.now(),
    hostId: chosen.hostId,
    instanceId: chosen.instanceId,
    location: chosen.kind,
    pluginId: request.plugin.id,
    pluginVersion: request.plugin.version,
    toolId: request.toolId,
    detail: reason
  })
  return { host: chosen, location: chosen.kind, reason }
}
