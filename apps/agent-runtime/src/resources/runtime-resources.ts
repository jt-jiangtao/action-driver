import type { ResourceEntry, ResourceOperationContext, ResourceReadResult, ResourceScope, ResourceWriteRequest } from '@actiondriver/runtime-contracts'
import { join } from 'node:path'
import type { SessionInputFileStore } from '../media/session-input-file-store'
import type { SessionOutputStore } from '../media/session-output-store'
import type { ResourceRoutesPort } from '../service/http/http-routes-resources'
import { createInputFileProvider, createOutputFileProvider, type InputFilePort, type OutputFilePort } from './media-providers'
import { PLUGIN_RESOURCE_SCHEME, createPluginResourceProvider } from './plugin-resources'
import { ResourceProviderRegistry } from './registry'
import { createRemoteResourceProvider, type RemoteResourceTransport } from './remote-provider'
import { createHttpRemoteResourceTransport } from './remote-http-transport'
import { VersionedResourceStore } from './store'
import { createSessionScopedStoreProvider } from './work-provider'

/** Provider protocol versions this runtime host understands. */
export const RESOURCE_PROVIDER_VERSIONS = [1] as const

export const WORKSPACE_RESOURCE_SCHEME = 'workspace'
/** JSON list of `{ scheme, baseUrl, token, version? }` remote resource hosts to proxy. */
export const REMOTE_RESOURCE_HOSTS_ENV = 'ACTIONDRIVER_RESOURCE_REMOTE_HOSTS'

export type RemoteResourceRegistration = {
  descriptor: { scheme: string; version: number }
  /** Operations the remote host actually serves; omitted means all four. */
  capabilities?: { read?: boolean; write?: boolean; list?: boolean; watch?: boolean }
  transport: RemoteResourceTransport
}

export interface RuntimeResourcePorts {
  /** Uploaded session inputs, authorized by the caller's session. */
  inputFiles: InputFilePort
  /** Immutable per-task deliverable snapshots, authorized by task and session. */
  outputs: OutputFilePort
  /** Writable work resources and plugin artifacts live under this root. */
  resourceRoot: string
  /** Remote hosts the runtime proxies, registered by scheme. */
  remote?: readonly RemoteResourceRegistration[]
  now?(): number
}

export interface RuntimeResources {
  registry: ResourceProviderRegistry
  workStore: VersionedResourceStore
  pluginStore: VersionedResourceStore
}

const SCHEME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/**
 * Remote hosts are declared by configuration, never discovered from a URI: an unknown scheme must
 * keep failing instead of silently resolving anywhere. An unparsable declaration is a hard error,
 * so a typo cannot quietly downgrade a remote host to "unavailable".
 */
export function parseRemoteResourceHosts(
  environment: NodeJS.ProcessEnv,
  options: { fetch?: typeof fetch } = {}
): RemoteResourceRegistration[] {
  const raw = environment[REMOTE_RESOURCE_HOSTS_ENV]?.trim()
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${REMOTE_RESOURCE_HOSTS_ENV} must be valid JSON`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${REMOTE_RESOURCE_HOSTS_ENV} must be a JSON array`)
  return parsed.map(entry => {
    const host = entry as { scheme?: unknown; version?: unknown; baseUrl?: unknown; token?: unknown }
    if (typeof host.scheme !== 'string' || !SCHEME_PATTERN.test(host.scheme)) throw new Error(`${REMOTE_RESOURCE_HOSTS_ENV}: invalid scheme`)
    if (typeof host.baseUrl !== 'string' || !/^https?:\/\//.test(host.baseUrl)) throw new Error(`${REMOTE_RESOURCE_HOSTS_ENV}: ${host.scheme} needs an http(s) baseUrl`)
    if (typeof host.token !== 'string' || !host.token) throw new Error(`${REMOTE_RESOURCE_HOSTS_ENV}: ${host.scheme} needs a token`)
    const version = host.version === undefined ? 1 : host.version
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error(`${REMOTE_RESOURCE_HOSTS_ENV}: ${host.scheme} has an invalid protocol version`)
    return {
      descriptor: { scheme: host.scheme, version },
      // The HTTP surface has bounded read/list/write but no push channel yet, so a remote host
      // must not advertise watch and hand callers a capability error later.
      capabilities: { read: true, write: true, list: true, watch: false },
      transport: createHttpRemoteResourceTransport({
        baseUrl: host.baseUrl,
        token: host.token,
        ...(options.fetch ? { fetch: options.fetch } : {})
      })
    }
  })
}

/**
 * Registers the host-owned read-only providers. Both are backed by the persisted ownership
 * records, so the URI only locates a resource and the provider still re-checks who is asking.
 */
export function createRuntimeResourceRegistry(ports: RuntimeResourcePorts): RuntimeResources {
  const registry = new ResourceProviderRegistry({
    supportedVersions: [...RESOURCE_PROVIDER_VERSIONS],
    now: ports.now ?? Date.now
  })
  registry.register(
    { scheme: 'session-input', version: 1, capabilities: { read: true, list: true, watch: true } },
    createInputFileProvider(ports.inputFiles)
  )
  registry.register(
    { scheme: 'generated-output', version: 1, capabilities: { read: true, list: true, watch: true } },
    createOutputFileProvider(ports.outputs)
  )
  const workStore = new VersionedResourceStore({ root: join(ports.resourceRoot, 'workspace') })
  const pluginStore = new VersionedResourceStore({ root: join(ports.resourceRoot, 'plugins') })
  registry.register(
    { scheme: WORKSPACE_RESOURCE_SCHEME, version: 1, capabilities: { read: true, write: true, list: true, watch: true } },
    createSessionScopedStoreProvider({ scheme: WORKSPACE_RESOURCE_SCHEME, store: workStore })
  )
  registry.register(
    { scheme: PLUGIN_RESOURCE_SCHEME, version: 1, capabilities: { read: true, write: true, list: true, watch: true } },
    createPluginResourceProvider(pluginStore)
  )
  for (const remote of ports.remote ?? []) {
    registry.register(
      {
        ...remote.descriptor,
        capabilities: {
          read: remote.capabilities?.read ?? true,
          write: remote.capabilities?.write ?? true,
          list: remote.capabilities?.list ?? true,
          watch: remote.capabilities?.watch ?? true
        }
      },
      createRemoteResourceProvider(remote.transport)
    )
  }
  return { registry, workStore, pluginStore }
}

export interface RuntimeResourceStores {
  /** Binds uploaded inputs to their materialized session copy. */
  inputFiles: Pick<SessionInputFileStore, 'read'>
  /** Persisted input ownership records; list results are filtered to bound uploads. */
  inputFileRecords: {
    listBySession(sessionId: string): Promise<
      Array<{ fileId: string; status: string; name: string; mimeType: string; byteLength: number }>
    >
  }
  /** Registered deliverable snapshots, keyed by task and session. */
  outputs: Pick<SessionOutputStore, 'readSnapshot' | 'listByTask'>
  /** Directory the writable work and plugin resource stores live under. */
  resourceRoot: string
  remote?: readonly RemoteResourceRegistration[]
  now?(): number
}

/** Wires the persisted stores to the read-only providers the runtime registers. */
export function createRuntimeResourceRegistryFromStores(stores: RuntimeResourceStores): RuntimeResources {
  return createRuntimeResourceRegistry({
    inputFiles: {
      read: (fileId, sessionId) => stores.inputFiles.read(fileId, sessionId),
      listBound: async (sessionId) =>
        (await stores.inputFileRecords.listBySession(sessionId))
          .filter((file) => file.status === 'bound')
          .map((file) => ({
            fileId: file.fileId,
            name: file.name,
            mimeType: file.mimeType,
            byteLength: file.byteLength
          }))
    },
    outputs: {
      readSnapshot: (input) => stores.outputs.readSnapshot(input),
      listByTask: (taskId) => stores.outputs.listByTask(taskId)
    },
    resourceRoot: stores.resourceRoot,
    ...(stores.remote ? { remote: stores.remote } : {}),
    ...(stores.now ? { now: stores.now } : {})
  })
}

export interface ResourceHttpPortOptions {
  timeoutMs?: number
  now?(): number
}

/**
 * Adapts the registry to the HTTP route port. Each request runs with a fresh deadline and its
 * own cancellation signal; the caller's scope is passed through untouched so the registry can
 * refuse a URI that claims another task or session.
 */
export function createResourceHttpPort(registry: ResourceProviderRegistry, options: ResourceHttpPortOptions = {}): ResourceRoutesPort {
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? Date.now
  const context = (scope: ResourceScope): ResourceOperationContext => ({
    authority: scope,
    deadline: now() + timeoutMs,
    signal: new AbortController().signal
  })
  return {
    read: (uri: string, scope: ResourceScope): Promise<ResourceReadResult> => registry.read(uri, context(scope)),
    list: (uri: string, scope: ResourceScope): Promise<ResourceEntry[]> => registry.list(uri, context(scope)),
    write: (uri: string, request: ResourceWriteRequest, scope: ResourceScope): Promise<ResourceEntry> => registry.write(uri, request, context(scope))
  }
}
