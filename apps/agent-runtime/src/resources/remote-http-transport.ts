import { ResourceError } from '@actiondriver/runtime-contracts'
import type { ResourceEntry, ResourceOperationContext, ResourceReadResult, ResourceWatchEvent, ResourceWriteRequest } from '@actiondriver/runtime-contracts'
import { boundedStream } from './store'
import type { RemoteResourceTransport } from './remote-provider'

const PROBE_INTERVAL_MS = 1_000

export interface RemoteHttpHostOptions {
  /** Base URL of another ActionDriver runtime that hosts this scheme. */
  baseUrl: string
  token: string
  fetch?: typeof fetch
  now?(): number
}

/**
 * Speaks the runtime resource HTTP surface to a remote host. The transport never degrades to a
 * local path: a refused or unreachable request surfaces as a structured resource failure, and it
 * revalidates reachability before reconnecting so a stale connection is not silently reused.
 */
export function createHttpRemoteResourceTransport(options: RemoteHttpHostOptions): RemoteResourceTransport {
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now
  let connected: boolean | null = null
  let checkedAt = 0

  const post = async (path: string, body: unknown, signal: AbortSignal): Promise<{ ok: boolean; status: number; payload: unknown }> => {
    const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  }

  const failureOf = (result: { status: number; payload: unknown }): ResourceError => {
    const error = (result.payload as { error?: { code?: string; message?: string } } | null)?.error
    const code = error?.code
    const known = ['RESOURCE_INVALID_URI', 'RESOURCE_SCHEME_UNKNOWN', 'RESOURCE_UNAUTHORIZED', 'RESOURCE_NOT_FOUND', 'RESOURCE_UNAVAILABLE', 'RESOURCE_UNSUPPORTED', 'RESOURCE_VERSION_CONFLICT', 'RESOURCE_IMMUTABLE', 'RESOURCE_CANCELLED', 'RESOURCE_DEADLINE_EXCEEDED'] as const
    if (code && (known as readonly string[]).includes(code)) return new ResourceError(code as typeof known[number], error?.message ?? code)
    // A transport-level status (401/404/5xx) means the host is no longer usable for this scheme.
    return new ResourceError('RESOURCE_UNAVAILABLE', `remote host refused the operation (${result.status})`)
  }

  const run = async <T>(operation: (signal: AbortSignal) => Promise<T>, context: ResourceOperationContext): Promise<T> => {
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, context.deadline - now()))])
    try {
      const result = await operation(signal)
      connected = true
      checkedAt = now()
      return result
    } catch (error) {
      if (error instanceof ResourceError) throw error
      if (context.signal.aborted) throw new ResourceError('RESOURCE_CANCELLED', `${context.authority.sessionId ?? 'resource'}: cancelled`)
      connected = false
      throw error
    }
  }

  const body = (uri: string, context: ResourceOperationContext): Record<string, unknown> => ({
    uri,
    sessionId: context.authority.sessionId,
    ...(context.authority.taskId ? { taskId: context.authority.taskId } : {}),
    ...(context.authority.version ? { version: context.authority.version } : {})
  })

  return {
    async isConnected(): Promise<boolean> {
      if (connected !== null && now() - checkedAt < PROBE_INTERVAL_MS) return connected
      try {
        const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, '')}/readyz`, {
          headers: { authorization: `Bearer ${options.token}` }
        })
        connected = response.ok
      } catch {
        connected = false
      }
      checkedAt = now()
      return connected
    },
    async read(uri, context): Promise<ResourceReadResult> {
      return run(async signal => {
        const result = await post('/resources/read', body(uri, context), signal)
        if (!result.ok) throw failureOf(result)
        const value = (result.payload as { value: { uri: string; version: string; contentType?: string; base64: string } }).value
        return { uri: value.uri, version: value.version, ...(value.contentType ? { contentType: value.contentType } : {}), stream: boundedStream(new Uint8Array(Buffer.from(value.base64, 'base64'))) }
      }, context)
    },
    async list(uri, context): Promise<ResourceEntry[]> {
      return run(async signal => {
        const result = await post('/resources/list', body(uri, context), signal)
        if (!result.ok) throw failureOf(result)
        return (result.payload as { value: ResourceEntry[] }).value
      }, context)
    },
    async write(uri, request: ResourceWriteRequest, context): Promise<ResourceEntry> {
      return run(async signal => {
        const chunks: Uint8Array[] = []
        for await (const chunk of request.stream) chunks.push(chunk)
        const result = await post('/resources/write', {
          ...body(uri, context),
          base64: Buffer.concat(chunks).toString('base64'),
          ...(request.expectedVersion ? { expectedVersion: request.expectedVersion } : {}),
          ...(request.createOnly ? { createOnly: request.createOnly } : {}),
          ...(request.contentType ? { contentType: request.contentType } : {})
        }, signal)
        if (!result.ok) throw failureOf(result)
        return (result.payload as { value: ResourceEntry }).value
      }, context)
    },
    async watch(): Promise<AsyncIterable<ResourceWatchEvent>> {
      // The runtime surface exposes polling reads, not a push channel yet, so a remote watch
      // reports a gap the caller must re-synchronize from instead of pretending it is live.
      throw new ResourceError('RESOURCE_UNSUPPORTED', 'remote watch requires a streaming host')
    }
  }
}
