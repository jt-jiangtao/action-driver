import { ResourceError } from '@actiondriver/runtime-contracts'
import type {
  ResourceEntry,
  ResourceOperationContext,
  ResourceProvider,
  ResourceReadResult,
  ResourceWatchEvent,
  ResourceWriteRequest
} from '@actiondriver/runtime-contracts'

/**
 * Transport a remote provider speaks over. The runtime never copies remote bytes into local
 * storage: a disconnected host fails the operation instead of falling back to a same-named file.
 */
export interface RemoteResourceTransport {
  /** False once the remote host disconnected or its lease expired. May probe asynchronously. */
  isConnected(): boolean | Promise<boolean>
  read(uri: string, context: ResourceOperationContext): Promise<ResourceReadResult>
  write(uri: string, request: ResourceWriteRequest, context: ResourceOperationContext): Promise<ResourceEntry>
  list(uri: string, context: ResourceOperationContext): Promise<ResourceEntry[]>
  watch(uri: string, context: ResourceOperationContext): Promise<AsyncIterable<ResourceWatchEvent>>
}

function reasonOf(error: unknown): string {
  return (error as { code?: string })?.code ?? 'REMOTE_UNAVAILABLE'
}

function translate(error: unknown, uri: string, context: ResourceOperationContext): ResourceError {
  if (error instanceof ResourceError) return error
  if (context.signal.aborted) return new ResourceError('RESOURCE_CANCELLED', `${uri}: cancelled before the remote host answered`)
  if (context.deadline <= Date.now()) return new ResourceError('RESOURCE_DEADLINE_EXCEEDED', `${uri}: the remote host did not answer before the deadline`)
  return new ResourceError('RESOURCE_UNAVAILABLE', `${uri}: remote host unavailable (${reasonOf(error)})`)
}

async function guard(transport: RemoteResourceTransport, uri: string): Promise<void> {
  if (!(await transport.isConnected())) throw new ResourceError('RESOURCE_UNAVAILABLE', `${uri}: the remote host is disconnected`)
}

/**
 * Wraps a remote transport behind the resource provider contract: disconnect, cancellation and
 * deadline become structured resource errors, and a watch that loses its host reports a
 * re-synchronization gap instead of pretending the event stream was continuous.
 */
export function createRemoteResourceProvider(transport: RemoteResourceTransport): ResourceProvider {
  const streamOf = async function * (uri: string, context: ResourceOperationContext, stream: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
    try {
      for await (const chunk of stream) {
        if (context.signal.aborted) throw new ResourceError('RESOURCE_CANCELLED', `${uri}: read cancelled`)
        yield chunk
      }
    } catch (error) {
      throw translate(error, uri, context)
    }
  }

  return {
    async read(uri, context): Promise<ResourceReadResult> {
      await guard(transport, uri)
      try {
        const result = await transport.read(uri, context)
        return { ...result, stream: streamOf(uri, context, result.stream) }
      } catch (error) {
        throw translate(error, uri, context)
      }
    },
    async write(uri, request: ResourceWriteRequest, context): Promise<ResourceEntry> {
      await guard(transport, uri)
      try {
        return await transport.write(uri, request, context)
      } catch (error) {
        const failure = translate(error, uri, context)
        // A write that lost its host may or may not have committed remotely; report the unknown
        // outcome and never replay it automatically.
        if (failure.code === 'RESOURCE_UNAVAILABLE') throw new ResourceError('RESOURCE_UNAVAILABLE', `${failure.message}; the write outcome is unknown and was not retried`)
        throw failure
      }
    },
    async list(uri, context): Promise<ResourceEntry[]> {
      await guard(transport, uri)
      try {
        return await transport.list(uri, context)
      } catch (error) {
        throw translate(error, uri, context)
      }
    },
    async watch(uri, context): Promise<AsyncIterable<ResourceWatchEvent>> {
      await guard(transport, uri)
      let source: AsyncIterable<ResourceWatchEvent>
      try {
        source = await transport.watch(uri, context)
      } catch (error) {
        throw translate(error, uri, context)
      }
      return (async function * () {
        const iterator = source[Symbol.asyncIterator]()
        while (true) {
          let next: IteratorResult<ResourceWatchEvent>
          try {
            next = await iterator.next()
          } catch (error) {
            const failure = translate(error, uri, context)
            if (failure.code === 'RESOURCE_CANCELLED') throw failure
            yield { kind: 'resync-required', uri }
            return
          }
          if (next.done) return
          yield next.value
        }
      })()
    }
  }
}
