import { ResourceError, formatResourceUri, parseResourceUri } from '@action-driver/runtime-contracts'
import type {
  ResourceEntry,
  ResourceOperationContext,
  ResourceProvider,
  ResourceReadResult,
  ResourceWatchEvent,
  ResourceWriteRequest
} from '@action-driver/runtime-contracts'
import type { VersionedResourceStore } from './store'

/** Virtual collection id that lists a session's writable resources without a path syntax. */
export const WORK_COLLECTION_ID = 'all'

function sessionOf(context: ResourceOperationContext): string {
  const sessionId = context.authority.sessionId
  if (!sessionId) throw new ResourceError('RESOURCE_UNAUTHORIZED', 'A session scope is required for writable resources')
  return sessionId
}

function collection(scheme: string, sessionId: string): string {
  return formatResourceUri({ scheme, id: sessionId, scope: { sessionId } })
}

/**
 * Writable resources live under a per-session namespace (`<sessionId>/<path>`), so the same
 * registry can serve every session while a URI that names another session is refused before the
 * store is touched. Versions, immutable deliverables and write conflicts stay in the store.
 */
export function createSessionScopedStoreProvider(options: { scheme: string; store: VersionedResourceStore }): ResourceProvider {
  const { scheme, store } = options

  const owned = (uri: string, sessionId: string): string => {
    const { id } = parseResourceUri(uri)
    if (id === WORK_COLLECTION_ID) return id
    if (id !== sessionId && !id.startsWith(`${sessionId}/`)) {
      throw new ResourceError('RESOURCE_UNAUTHORIZED', `${id}: resource belongs to another session`)
    }
    return id
  }

  const listUri = (uri: string, sessionId: string): string => {
    const { id } = parseResourceUri(uri)
    if (id === WORK_COLLECTION_ID) return collection(scheme, sessionId)
    owned(uri, sessionId)
    return uri
  }

  return {
    async read(uri, context): Promise<ResourceReadResult> {
      owned(uri, sessionOf(context))
      return store.read(uri, context)
    },
    async write(uri, request: ResourceWriteRequest, context): Promise<ResourceEntry> {
      owned(uri, sessionOf(context))
      return store.write(uri, request, context)
    },
    async list(uri, context): Promise<ResourceEntry[]> {
      const sessionId = sessionOf(context)
      const entries = await store.list(listUri(uri, sessionId), context)
      return entries.map(entry => ({ ...entry, uri: formatResourceUri({ scheme, id: entry.uri, scope: { sessionId } }) }))
    },
    async watch(uri, context): Promise<AsyncIterable<ResourceWatchEvent>> {
      owned(uri, sessionOf(context))
      return store.watch(uri, context)
    }
  }
}
