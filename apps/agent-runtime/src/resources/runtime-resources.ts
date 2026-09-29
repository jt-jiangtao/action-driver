import type { ResourceEntry, ResourceOperationContext, ResourceReadResult, ResourceScope } from '@actiondriver/runtime-contracts'
import type { SessionInputFileStore } from '../media/session-input-file-store'
import type { SessionOutputStore } from '../media/session-output-store'
import type { ResourceRoutesPort } from '../service/http/http-routes-resources'
import { createInputFileProvider, createOutputFileProvider, type InputFilePort, type OutputFilePort } from './media-providers'
import { ResourceProviderRegistry } from './registry'

/** Provider protocol versions this runtime host understands. */
export const RESOURCE_PROVIDER_VERSIONS = [1] as const

export interface RuntimeResourcePorts {
  /** Uploaded session inputs, authorized by the caller's session. */
  inputFiles: InputFilePort
  /** Immutable per-task deliverable snapshots, authorized by task and session. */
  outputs: OutputFilePort
  now?(): number
}

/**
 * Registers the host-owned read-only providers. Both are backed by the persisted ownership
 * records, so the URI only locates a resource and the provider still re-checks who is asking.
 */
export function createRuntimeResourceRegistry(ports: RuntimeResourcePorts): ResourceProviderRegistry {
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
  return registry
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
  now?(): number
}

/** Wires the persisted stores to the read-only providers the runtime registers. */
export function createRuntimeResourceRegistryFromStores(stores: RuntimeResourceStores): ResourceProviderRegistry {
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
    list: (uri: string, scope: ResourceScope): Promise<ResourceEntry[]> => registry.list(uri, context(scope))
  }
}
