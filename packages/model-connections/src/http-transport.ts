export type HttpRequest = {
  url: string
  method: 'GET' | 'POST' | 'DELETE'
  headers: Record<string, string>
  body?: unknown
  timeoutMs: number
  signal?: AbortSignal
}

export type HttpResponse = {
  status: number
  body: unknown
  text: string
}

export type HttpTransportFailureCode = 'network' | 'timeout' | 'cancelled'

export class HttpTransportError extends Error {
  constructor(
    readonly code: HttpTransportFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'HttpTransportError'
  }
}

export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export function createFetchHttpTransport(fetchImplementation?: FetchLike): HttpTransport {
  return {
    async request(request) {
      const fetchImpl = fetchImplementation ?? (globalThis.fetch as FetchLike | undefined)
      if (!fetchImpl) {
        throw new HttpTransportError('network', 'HTTP transport is unavailable')
      }

      const controller = new AbortController()
      if (request.signal?.aborted) {
        throw new HttpTransportError('cancelled', `Request to ${request.url} was cancelled`)
      }
      const abortFromCaller = () => controller.abort(request.signal?.reason)
      request.signal?.addEventListener('abort', abortFromCaller, { once: true })
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
      const init: RequestInit = {
        method: request.method,
        headers: {
          ...request.headers,
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
      }
      try {
        let response: Response
        try {
          response = await fetchImpl(request.url, { ...init, signal: controller.signal })
        } catch (error) {
          // Test environments can supply a fetch implementation from another realm whose
          // AbortSignal is not accepted. Fall back to a raced deadline instead of failing.
          if (!controller.signal.aborted && isForeignAbortSignalRejection(error)) {
            response = await withDeadline(
              fetchImpl(request.url, init),
              request.timeoutMs,
              request.url
            )
          } else {
            throw error
          }
        }
        const text = await response.text()
        return { status: response.status, body: parseJson(text), text }
      } catch (error) {
        if (controller.signal.aborted) {
          if (request.signal?.aborted) {
            throw new HttpTransportError('cancelled', `Request to ${request.url} was cancelled`)
          }
          throw new HttpTransportError('timeout', `Request to ${request.url} timed out`)
        }
        throw new HttpTransportError(
          'network',
          `${request.url} is unreachable: ${error instanceof Error ? error.message : String(error)}`
        )
      } finally {
        clearTimeout(timeout)
        request.signal?.removeEventListener('abort', abortFromCaller)
      }
    }
  }
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isForeignAbortSignalRejection(error: unknown): boolean {
  return error instanceof TypeError && /AbortSignal/i.test(error.message)
}

function withDeadline(
  pending: Promise<Response>,
  timeoutMs: number,
  url: string
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new HttpTransportError('timeout', `Request to ${url} timed out`)),
      timeoutMs
    )
    pending.then(
      (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
