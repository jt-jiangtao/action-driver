import {
  ModelServiceError,
  type ModelAddRequestDto,
  type ModelConnectionDto,
  type ModelConnectionDraftDto,
  type ModelConnectionTestRequestDto,
  type ModelConnectionTestResultDto,
  type ModelFailureCode,
  type ModelOptionDto,
  type ModelSetEnabledRequestDto,
  type ModelTestRequestDto,
  type ModelTestResultDto
} from '@actiondriver/model-connections'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export const SERVICE_PROTOCOL_VERSION = 1

export type ServiceModelConnectionPort = {
  list(): ModelConnectionDto[]
  testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto>
  discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]>
  refresh(connectionId: string): Promise<ModelOptionDto[]>
  testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]>
  testConnectionModels(request: ModelConnectionTestRequestDto): Promise<ModelTestResultDto[]>
  setModelEnabled(request: ModelSetEnabledRequestDto): Promise<void>
  add(request: ModelAddRequestDto): Promise<ModelConnectionDto>
  delete(connectionId: string): Promise<void>
}

export type ServiceHttpOptions = {
  service: ServiceModelConnectionPort
  token: string
  runtimeVersion: string
  host?: string
  port?: number
  bodyLimitBytes?: number
}

export type ServiceHttpServer = {
  url: string
  port: number
  close(): Promise<void>
}

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: ModelFailureCode; message: string } }

const DEFAULT_BODY_LIMIT = 1_000_000

/**
 * HTTP surface of the local service: configuration and model connection management.
 * Sessions use the WebSocket channel instead.
 */
export async function startServiceHttpServer(
  options: ServiceHttpOptions
): Promise<ServiceHttpServer> {
  const host = options.host ?? '127.0.0.1'
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT
  const tokenDigest = createHash('sha256').update(options.token).digest()
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, tokenDigest, bodyLimit)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Service HTTP server did not expose a TCP address')
  }

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    close: () => closeServer(server)
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServiceHttpOptions,
  tokenDigest: Buffer,
  bodyLimit: number
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const method = request.method ?? 'GET'

  // Browser origins are rejected, mirroring Codex app-server behaviour, so a rendered page can
  // never drive the local service directly.
  if (request.headers.origin) {
    sendJson(response, 403, failure('unauthorized', 'Browser origins are not allowed'))
    return
  }

  if (url.pathname === '/readyz' || url.pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }

  if (!isAuthorized(request, tokenDigest)) {
    sendJson(response, 401, failure('unauthorized', 'A valid service credential is required'))
    return
  }

  try {
    if (method === 'GET' && url.pathname === '/version') {
      sendJson(response, 200, {
        ok: true,
        value: {
          runtimeVersion: options.runtimeVersion,
          protocolVersion: SERVICE_PROTOCOL_VERSION
        }
      })
      return
    }

    if (method === 'GET' && url.pathname === '/model-connections') {
      sendJson(response, 200, { ok: true, value: options.service.list() })
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections') {
      const body = await readJson(request, bodyLimit)
      sendJson(response, 200, { ok: true, value: await options.service.add(body as ModelAddRequestDto) })
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections/test') {
      const body = await readJson(request, bodyLimit)
      sendJson(response, 200, {
        ok: true,
        value: await options.service.testConnection(body as ModelConnectionDraftDto)
      })
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections/discover') {
      const body = await readJson(request, bodyLimit)
      sendJson(response, 200, {
        ok: true,
        value: await options.service.discover(body as ModelConnectionDraftDto)
      })
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections/test-models') {
      const body = await readJson(request, bodyLimit)
      sendJson(response, 200, {
        ok: true,
        value: await options.service.testModels(body as ModelTestRequestDto)
      })
      return
    }

    const connectionRoute = matchConnectionRoute(url.pathname)
    if (connectionRoute) {
      const { connectionId, action, modelId } = connectionRoute
      if (method === 'DELETE' && action === undefined) {
        await options.service.delete(connectionId)
        sendJson(response, 200, { ok: true, value: null })
        return
      }
      if (method === 'POST' && action === 'refresh') {
        sendJson(response, 200, {
          ok: true,
          value: await options.service.refresh(connectionId)
        })
        return
      }
      if (method === 'POST' && action === 'test-models') {
        const body = await readJson(request, bodyLimit)
        const request_ = body as { modelIds?: unknown }
        sendJson(response, 200, {
          ok: true,
          value: await options.service.testConnectionModels({
            connectionId,
            modelIds: Array.isArray(request_.modelIds) ? (request_.modelIds as string[]) : []
          })
        })
        return
      }
      if (method === 'POST' && action === 'models' && modelId) {
        const body = await readJson(request, bodyLimit)
        const enabled = (body as { enabled?: unknown }).enabled === true
        await options.service.setModelEnabled({ connectionId, modelId, enabled })
        sendJson(response, 200, { ok: true, value: null })
        return
      }
    }

    sendJson(response, 404, failure('not-found', `Unknown route: ${method} ${url.pathname}`))
  } catch (error) {
    const mapped = toEnvelopeError(error)
    sendJson(response, mapped.status, failure(mapped.code, mapped.message))
  }
}

function matchConnectionRoute(
  pathname: string
): { connectionId: string; action?: 'refresh' | 'test-models' | 'models'; modelId?: string } | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'model-connections' || segments.length < 2) return null
  const connectionId = decodeURIComponent(segments[1] as string)
  if (segments.length === 2) return { connectionId }
  const action = segments[2]
  if (action === 'refresh' && segments.length === 3) return { connectionId, action }
  if (action === 'test-models' && segments.length === 3) return { connectionId, action }
  if (action === 'models' && segments.length === 4) {
    return { connectionId, action, modelId: decodeURIComponent(segments[3] as string) }
  }
  return null
}

function isAuthorized(request: IncomingMessage, tokenDigest: Buffer): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest()
  return presented.length === tokenDigest.length && timingSafeEqual(presented, tokenDigest)
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new ModelServiceError('invalid-request', 'Request body is too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ModelServiceError('invalid-request', 'Request body must be valid JSON')
  }
}

function toEnvelopeError(error: unknown): {
  status: number
  code: ModelFailureCode
  message: string
} {
  if (error instanceof ModelServiceError) {
    return { status: 200, code: error.code, message: error.message }
  }
  return {
    status: 500,
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error)
  }
}

function failure(code: ModelFailureCode, message: string): Envelope<never> {
  return { ok: false, error: { code, message } }
}

function sendJson(response: ServerResponse, status: number, payload: Envelope<unknown>): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  })
  response.end(body)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}
