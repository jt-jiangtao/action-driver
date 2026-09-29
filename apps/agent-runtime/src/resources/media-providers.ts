import { ResourceError, formatResourceUri, parseResourceUri } from '@actiondriver/runtime-contracts'
import type { ResourceEntry, ResourceOperationContext, ResourceProvider, ResourceScope, ResourceWatchEvent } from '@actiondriver/runtime-contracts'
import { boundedStream } from './store'

/** Virtual collection id used to list a scheme's resources without inventing a path syntax. */
export const RESOURCE_COLLECTION_ID = 'all'

/**
 * Resolves a legacy file identifier into the unified URI space. Old task cards and stored
 * references keep working because the file id is the resource id, not a rewritten pointer.
 */
export function legacyResourceUri(scheme: 'session-input' | 'generated-output', fileId: string, scope: ResourceScope): string {
  if (!fileId) throw new ResourceError('RESOURCE_NOT_FOUND', 'A resource id is required')
  return formatResourceUri({ scheme, id: fileId, scope })
}

function scopeOf(context: ResourceOperationContext): { sessionId: string; taskId?: string } {
  const sessionId = context.authority.sessionId
  if (!sessionId) throw new ResourceError('RESOURCE_UNAUTHORIZED', 'A session scope is required')
  return { sessionId, ...(context.authority.taskId ? { taskId: context.authority.taskId } : {}) }
}

export interface InputFilePort {
  read(fileId: string, sessionId: string): Promise<{ bytes: Uint8Array; name: string; mimeType: string }>
  listBound(sessionId: string): Promise<BoundInputFileEntry[]>
}

export type BoundInputFileEntry = { fileId: string; name: string; mimeType: string; byteLength: number }

export interface OutputFilePort {
  readSnapshot(input: { fileId: string; taskId: string; sessionId: string }): Promise<{ bytes: Uint8Array; name: string; mimeType: string }>
  listByTask(taskId: string): Promise<RegisteredOutputEntry[]>
}

export type RegisteredOutputEntry = { fileId: string; sessionId: string; taskId: string; name: string; mimeType: string; byteLength: number }

function reasonOf(error: unknown): string {
  return (error as { code?: string })?.code ?? 'RESOURCE_UNAVAILABLE'
}

/** A subscription that never emits: immutable resources have no change events of their own. */
function forever(): AsyncIterable<ResourceWatchEvent> {
  return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<ResourceWatchEvent>>(() => {}) }) }
}

/**
 * Bound uploads are immutable, so they are served read-only: no version is ever replaced and the
 * subscription channel exists only so a cross-session watch is refused with the scope error.
 */
export function createInputFileProvider(ports: InputFilePort): ResourceProvider {
  const authority = (uri: string, context: ResourceOperationContext): { fileId: string; sessionId: string } => {
    const { id } = parseResourceUri(uri)
    return { fileId: id, sessionId: scopeOf(context).sessionId }
  }
  return {
    async read(uri, context) {
      const { fileId, sessionId } = authority(uri, context)
      try {
        const file = await ports.read(fileId, sessionId)
        return { uri, version: '1', contentType: file.mimeType, stream: boundedStream(file.bytes) }
      } catch (error) {
        throw new ResourceError(error instanceof ResourceError ? error.code : 'RESOURCE_NOT_FOUND', `${fileId}: ${reasonOf(error)}`)
      }
    },
    async list(uri, context): Promise<ResourceEntry[]> {
      const { id } = parseResourceUri(uri)
      if (id !== RESOURCE_COLLECTION_ID) throw new ResourceError('RESOURCE_NOT_FOUND', `${id}: inputs are addressed by file id`)
      const { sessionId } = scopeOf(context)
      return (await ports.listBound(sessionId)).map(file => ({ uri: legacyResourceUri('session-input', file.fileId, { sessionId }), version: '1', contentType: file.mimeType, size: file.byteLength, immutable: true }))
    },
    async watch(uri, context) {
      authority(uri, context)
      // Immutable uploads never change; the stream stays open so a future revocation ends it.
      return forever()
    }
  }
}

/** Registered deliverables keep their snapshot forever, so writes are refused and reads are pinned. */
export function createOutputFileProvider(ports: OutputFilePort): ResourceProvider {
  const authority = (uri: string, context: ResourceOperationContext): { fileId: string; sessionId: string; taskId: string } => {
    const { id } = parseResourceUri(uri)
    const scope = scopeOf(context)
    if (!scope.taskId) throw new ResourceError('RESOURCE_UNAUTHORIZED', 'A task scope is required for registered outputs')
    return { fileId: id, sessionId: scope.sessionId, taskId: scope.taskId }
  }
  return {
    async read(uri, context) {
      const scope = authority(uri, context)
      try {
        const file = await ports.readSnapshot(scope)
        return { uri, version: '1', contentType: file.mimeType, stream: boundedStream(file.bytes) }
      } catch (error) {
        throw new ResourceError(error instanceof ResourceError ? error.code : 'RESOURCE_NOT_FOUND', `${scope.fileId}: ${reasonOf(error)}`)
      }
    },
    async list(uri, context): Promise<ResourceEntry[]> {
      const { id } = parseResourceUri(uri)
      if (id !== RESOURCE_COLLECTION_ID) throw new ResourceError('RESOURCE_NOT_FOUND', `${id}: outputs are addressed by file id`)
      const scope = scopeOf(context)
      if (!scope.taskId) throw new ResourceError('RESOURCE_UNAUTHORIZED', 'A task scope is required for registered outputs')
      return (await ports.listByTask(scope.taskId))
        .filter(output => output.sessionId === scope.sessionId)
        .map(output => ({ uri: legacyResourceUri('generated-output', output.fileId, { sessionId: scope.sessionId, ...(scope.taskId ? { taskId: scope.taskId } : {}) }), version: '1', contentType: output.mimeType, size: output.byteLength, immutable: true }))
    },
    async watch(uri, context) {
      authority(uri, context)
      return forever()
    }
  }
}
