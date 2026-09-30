import { ResourceError, formatResourceUri, parseResourceUri } from '@action-driver/runtime-contracts'
import type {
  ResourceEntry,
  ResourceOperationContext,
  ResourceProvider,
  ResourceReadResult,
  ResourceWatchEvent
} from '@action-driver/runtime-contracts'
import type { InvocationContext, Json, PluginOwner } from '@action-driver/plugin-contracts'
import type { VersionedResourceStore } from './store';
import { boundedStream } from './store'

export const PLUGIN_RESOURCE_SCHEME = 'plugin'
export const PLUGIN_ARTIFACT_COLLECTION_ID = 'all'
/** Plugin artifacts travel inline through the host API, so they stay bounded. */
export const MAX_PLUGIN_ARTIFACT_BYTES = 8 * 1024 * 1024
const DEFAULT_DEADLINE_MS = 15_000

export function pluginArtifactResourceId(pluginId: string, sessionId: string, artifactId: string): string {
  return `${pluginId}/${sessionId}/${artifactId}`
}

type PluginScope = { pluginId: string; sessionId: string }

function scopeOf(context: ResourceOperationContext): PluginScope {
  const { pluginId, sessionId } = context.authority
  if (!pluginId || !sessionId) throw new ResourceError('RESOURCE_UNAUTHORIZED', 'A plugin and session scope are required for plugin resources')
  return { pluginId, sessionId }
}

function assertOwned(id: string, scope: PluginScope): void {
  if (id === PLUGIN_ARTIFACT_COLLECTION_ID) return
  if (!id.startsWith(`${scope.pluginId}/${scope.sessionId}/`)) {
    throw new ResourceError('RESOURCE_UNAUTHORIZED', `${id}: plugin resource belongs to another owner or session`)
  }
}

/**
 * Plugin-owned artifacts. The resource id itself names the owner and session, but the caller must
 * still hold that exact plugin and session authority, so a plugin cannot read a peer's artifact or
 * the same artifact from another session.
 */
export function createPluginResourceProvider(store: VersionedResourceStore): ResourceProvider {
  return {
    async read(uri, context): Promise<ResourceReadResult> {
      const scope = scopeOf(context)
      assertOwned(parseResourceUri(uri).id, scope)
      return store.read(uri, context)
    },
    async write(uri, request, context): Promise<ResourceEntry> {
      const scope = scopeOf(context)
      assertOwned(parseResourceUri(uri).id, scope)
      return store.write(uri, request, context)
    },
    async list(uri, context): Promise<ResourceEntry[]> {
      const scope = scopeOf(context)
      const { id } = parseResourceUri(uri)
      if (id !== PLUGIN_ARTIFACT_COLLECTION_ID) assertOwned(id, scope)
      const listed = await store.list(formatResourceUri({ scheme: PLUGIN_RESOURCE_SCHEME, id: `${scope.pluginId}/${scope.sessionId}`, scope: {} }), context)
      return listed.map(entry => ({
        ...entry,
        uri: formatResourceUri({ scheme: PLUGIN_RESOURCE_SCHEME, id: entry.uri, scope: {} })
      }))
    },
    async watch(uri, context): Promise<AsyncIterable<ResourceWatchEvent>> {
      const scope = scopeOf(context)
      assertOwned(parseResourceUri(uri).id, scope)
      return store.watch(uri, context)
    }
  }
}

export interface PluginArtifactHostPorts {
  create(owner: PluginOwner, input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json>
  read(owner: PluginOwner, input: Json, context: InvocationContext, signal: AbortSignal): Promise<Json>
}

export interface PluginArtifactPortOptions {
  store: VersionedResourceStore
  /** Registry-backed read so cross-owner and cross-session refusals keep their structured codes. */
  readResource(uri: string, authority: { pluginId: string; sessionId: string; taskId?: string }, context: ResourceOperationContext): Promise<ResourceReadResult>
  ids(): string
  now?(): number
}

/**
 * Host API bridge. `artifacts.create` writes a new immutable-by-convention artifact for the
 * calling plugin; `artifacts.read` accepts the unified URI and still accepts the legacy bare
 * artifact id so existing plugin code keeps working.
 */
export function createPluginArtifactHostPorts(options: PluginArtifactPortOptions): PluginArtifactHostPorts {
  const now = options.now ?? Date.now
  const writeInput = (input: Json): { artifactId?: string; contentType: string; bytes: Uint8Array } => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ResourceError('RESOURCE_INVALID_URI', 'Artifact input must be an object')
    const value = input as Record<string, Json>
    const data = value.data
    if (typeof data !== 'string' || !data) throw new ResourceError('RESOURCE_INVALID_URI', 'Artifact data is required')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.byteLength === 0) throw new ResourceError('RESOURCE_INVALID_URI', 'Artifact data is empty')
    if (bytes.byteLength > MAX_PLUGIN_ARTIFACT_BYTES) throw new ResourceError('RESOURCE_UNSUPPORTED', 'Artifact exceeds the inline limit')
    const contentType = typeof value.contentType === 'string' && value.contentType.length <= 128 ? value.contentType : 'application/octet-stream'
    const artifactId = typeof value.name === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value.name) ? value.name : undefined
    return { ...(artifactId ? { artifactId } : {}), contentType, bytes }
  }
  const sessionOf = (context: InvocationContext): string => {
    if (!context.sessionId) throw new ResourceError('RESOURCE_UNAUTHORIZED', 'A session context is required')
    return context.sessionId
  }
  return {
    async create(owner, input, context, signal): Promise<Json> {
      const parsed = writeInput(input)
      const sessionId = sessionOf(context)
      const artifactId = parsed.artifactId ?? options.ids()
      const id = pluginArtifactResourceId(owner.pluginId, sessionId, artifactId)
      const uri = formatResourceUri({ scheme: PLUGIN_RESOURCE_SCHEME, id, scope: {} })
      const entry = await options.store.write(uri, {
        createOnly: true,
        contentType: parsed.contentType,
        stream: boundedStream(parsed.bytes)
      }, {
        authority: { pluginId: owner.pluginId, sessionId, ...(context.taskId ? { taskId: context.taskId } : {}) },
        deadline: now() + DEFAULT_DEADLINE_MS,
        signal
      })
      return { uri: formatResourceUri({ scheme: PLUGIN_RESOURCE_SCHEME, id: entry.uri, scope: {} }), version: entry.version }
    },
    async read(owner, input, context, signal): Promise<Json> {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ResourceError('RESOURCE_INVALID_URI', 'Artifact input must be an object')
      const value = input as Record<string, Json>
      const sessionId = sessionOf(context)
      const authority = { pluginId: owner.pluginId, sessionId, ...(context.taskId ? { taskId: context.taskId } : {}) }
      let uri: string
      if (typeof value.uri === 'string') {
        const reference = parseResourceUri(value.uri)
        if (reference.scheme !== PLUGIN_RESOURCE_SCHEME) throw new ResourceError('RESOURCE_SCHEME_UNKNOWN', `${reference.scheme} is not a plugin resource`)
        uri = value.uri
      } else if (typeof value.id === 'string' && value.id) {
        // Legacy plugin code passes the bare artifact id it received from create().
        uri = formatResourceUri({
          scheme: PLUGIN_RESOURCE_SCHEME,
          id: value.id.includes('/') ? value.id : pluginArtifactResourceId(owner.pluginId, sessionId, value.id),
          scope: {}
        })
      } else throw new ResourceError('RESOURCE_INVALID_URI', 'An artifact uri or id is required')
      const read = await options.readResource(uri, authority, { authority, deadline: now() + DEFAULT_DEADLINE_MS, signal })
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of read.stream) {
        size += chunk.byteLength
        if (size > MAX_PLUGIN_ARTIFACT_BYTES) throw new ResourceError('RESOURCE_UNSUPPORTED', `${uri}: artifact exceeds the inline limit`)
        chunks.push(chunk)
      }
      return {
        uri: read.uri,
        version: read.version,
        byteLength: size,
        base64: Buffer.concat(chunks).toString('base64'),
        ...(read.contentType ? { contentType: read.contentType } : {})
      }
    }
  }
}
