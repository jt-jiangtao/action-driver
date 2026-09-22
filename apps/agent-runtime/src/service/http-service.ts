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
import type { Logger } from 'pino'
import {
  startBestEffortInteraction,
  type InteractionLogRecorder,
  type InteractionRecorderResult
} from '@actiondriver/observability'
import { LOG_LEVELS, readRecentLogRecords } from './logs'

export const SERVICE_PROTOCOL_VERSION = 1

export type ServiceModelConnectionPort = {
  list(): Promise<ModelConnectionDto[]>
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
  logger?: Logger
  logFilePath?: string | null
  host?: string
  port?: number
  bodyLimitBytes?: number
  interactions?: InteractionLogRecorder
}

export type ServiceHttpServer = {
  url: string
  port: number
  close(): Promise<void>
}

type Envelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ModelFailureCode; message: string } }

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
  const logger = options.logger ?? null
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, tokenDigest, bodyLimit, logger)
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
  bodyLimit: number,
  logger: Logger | null
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const method = request.method ?? 'GET'
  const startedAt = Date.now()
  const requestLog = logger?.child({ transport: 'http', method, path: url.pathname })
  let requestBody: unknown = null
  let finishPromise:
    | Promise<((result: InteractionRecorderResult) => Promise<void>) | null>
    | undefined
  const ensureCapture = () => {
    if (finishPromise) return finishPromise
    finishPromise =
      url.pathname === '/logs' || !options.interactions
        ? Promise.resolve(null)
        : startBestEffortInteraction(
            options.interactions,
            {
              transport: 'http',
              direction: 'renderer->service',
              operation: `${method} ${url.pathname}`,
              startedAt,
              request: {
                kind: 'json',
                value: {
                  method,
                  path: url.pathname,
                  query: Object.fromEntries(url.searchParams),
                  headers: request.headers,
                  body: requestBody
                },
                secretPaths: [
                  'headers.authorization',
                  'headers.proxy-authorization',
                  'headers.cookie',
                  'headers.set-cookie',
                  'headers.x-api-key',
                  'body.apiKey',
                  'body.draft.apiKey'
                ]
              }
            },
            (error) =>
              requestLog?.warn(
                { error: error instanceof Error ? error.message : String(error) },
                'interaction log write failed'
              )
          )
    return finishPromise
  }
  const secretValues = () => credentialValues(requestBody, ['apiKey', 'draft.apiKey'])
  const readCapturedJson = async () => {
    requestBody = await readJson(request, bodyLimit)
    await ensureCapture()
    return requestBody
  }
  const replyJson = async (status: number, payload: Envelope<unknown>) => {
    const finish = await ensureCapture()
    await finish?.({
      outcome: payload.ok ? 'ok' : 'error',
      status,
      response: { kind: 'json', value: payload },
      secretValues: secretValues(),
      ...(payload.ok ? {} : { error: payload.error })
    })
    sendJson(response, status, payload)
  }
  const replyText = async (status: number, text: string, contentType: string) => {
    const finish = await ensureCapture()
    await finish?.({
      outcome: status < 400 ? 'ok' : 'error',
      status,
      response: { kind: 'text', text, contentType },
      secretValues: secretValues()
    })
    response.writeHead(status, { 'content-type': contentType })
    response.end(text)
  }

  // Browser origins are rejected, mirroring Codex app-server behaviour, so a rendered page can
  // never drive the local service directly.
  if (request.headers.origin) {
    requestLog?.warn({ status: 403, reason: 'origin-rejected' }, 'service request rejected')
    await replyJson(403, failure('unauthorized', 'Browser origins are not allowed'))
    return
  }

  if (url.pathname === '/readyz' || url.pathname === '/healthz') {
    requestLog?.debug({ status: 200, durationMs: Date.now() - startedAt }, 'service health probe')
    await replyText(200, 'ok', 'text/plain')
    return
  }

  if (!isAuthorized(request, tokenDigest)) {
    requestLog?.warn({ status: 401, reason: 'unauthorized' }, 'service request rejected')
    await replyJson(401, failure('unauthorized', 'A valid service credential is required'))
    return
  }

  requestLog?.info({ status: 'accepted' }, 'service request received')

  try {
    if (method !== 'POST') await ensureCapture()
    if (method === 'GET' && url.pathname === '/version') {
      await replyJson(200, {
        ok: true,
        value: {
          runtimeVersion: options.runtimeVersion,
          protocolVersion: SERVICE_PROTOCOL_VERSION
        }
      })
      requestLog?.info({ status: 200, durationMs: Date.now() - startedAt }, 'service response')
      return
    }

    if (method === 'GET' && url.pathname === '/logs') {
      const limit = Number(url.searchParams.get('limit') ?? '')
      const level = url.searchParams.get('level') ?? undefined
      const records = options.logFilePath
        ? readRecentLogRecords({
            filePath: options.logFilePath,
            ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
            ...(level ? { minLevel: LOG_LEVELS[level] ?? LOG_LEVELS.info! } : {})
          })
        : []
      await replyJson(200, {
        ok: true,
        value: { records, filePath: options.logFilePath ?? null }
      })
      requestLog?.info(
        { status: 200, records: records.length, durationMs: Date.now() - startedAt },
        'service response'
      )
      return
    }

    if (method === 'GET' && url.pathname === '/model-connections') {
      const connections = await options.service.list()
      await replyJson(200, { ok: true, value: connections })
      requestLog?.info(
        { status: 200, connections: connections.length, durationMs: Date.now() - startedAt },
        'service response'
      )
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections') {
      const body = await readCapturedJson()
      const created = await options.service.add(body as ModelAddRequestDto)
      await replyJson(200, { ok: true, value: created })
      requestLog?.info(
        { status: 200, connectionId: created.id, durationMs: Date.now() - startedAt },
        'service response'
      )
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections/test') {
      const body = await readCapturedJson()
      const request_ = body as ModelConnectionDraftDto
      const childLog = requestLog?.child({
        protocol: request_.protocol,
        baseUrl: request_.baseUrl,
        apiKey: '[redacted]'
      })
      const result = await options.service.testConnection(request_)
      await replyJson(200, {
        ok: true,
        value: result
      })
      childLog?.info(
        {
          status: 200,
          outcome: result.ok ? 'ok' : result.failure.code,
          durationMs: Date.now() - startedAt
        },
        'service response'
      )
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections/discover') {
      const body = await readCapturedJson()
      const request_ = body as ModelConnectionDraftDto
      const models = await options.service.discover(request_)
      await replyJson(200, {
        ok: true,
        value: models
      })
      requestLog?.info(
        {
          status: 200,
          protocol: request_.protocol,
          baseUrl: request_.baseUrl,
          models: models.length,
          durationMs: Date.now() - startedAt
        },
        'service response'
      )
      return
    }

    if (method === 'POST' && url.pathname === '/model-connections/test-models') {
      const body = await readCapturedJson()
      const request_ = body as ModelTestRequestDto
      const results = await options.service.testModels(request_)
      await replyJson(200, {
        ok: true,
        value: results
      })
      requestLog?.info(
        {
          status: 200,
          models: results.length,
          unsupported: results.filter((result) => result.state === 'unsupported').length,
          failed: results.filter((result) => result.state === 'failed').length,
          durationMs: Date.now() - startedAt
        },
        'service response'
      )
      return
    }

    const connectionRoute = matchConnectionRoute(url.pathname)
    if (connectionRoute) {
      const { connectionId, action, modelId } = connectionRoute
      if (method === 'DELETE' && action === undefined) {
        await options.service.delete(connectionId)
        await replyJson(200, { ok: true, value: null })
        requestLog?.info(
          { status: 200, connectionId, durationMs: Date.now() - startedAt },
          'service response'
        )
        return
      }
      if (method === 'POST' && action === 'refresh') {
        await ensureCapture()
        const models = await options.service.refresh(connectionId)
        await replyJson(200, {
          ok: true,
          value: models
        })
        requestLog?.info(
          { status: 200, connectionId, models: models.length, durationMs: Date.now() - startedAt },
          'service response'
        )
        return
      }
      if (method === 'POST' && action === 'test-models') {
        const body = await readCapturedJson()
        const request_ = body as { modelIds?: unknown }
        const modelIds = Array.isArray(request_.modelIds) ? (request_.modelIds as string[]) : []
        const results = await options.service.testConnectionModels({ connectionId, modelIds })
        await replyJson(200, {
          ok: true,
          value: results
        })
        requestLog?.info(
          {
            status: 200,
            connectionId,
            models: results.length,
            durationMs: Date.now() - startedAt
          },
          'service response'
        )
        return
      }
      if (method === 'POST' && action === 'models' && modelId) {
        const body = await readCapturedJson()
        const enabled = (body as { enabled?: unknown }).enabled === true
        await options.service.setModelEnabled({ connectionId, modelId, enabled })
        await replyJson(200, { ok: true, value: null })
        requestLog?.info(
          { status: 200, connectionId, modelId, enabled, durationMs: Date.now() - startedAt },
          'service response'
        )
        return
      }
    }

    requestLog?.warn({ status: 404, durationMs: Date.now() - startedAt }, 'service response')
    await replyJson(404, failure('not-found', `Unknown route: ${method} ${url.pathname}`))
  } catch (error) {
    const mapped = toEnvelopeError(error)
    requestLog?.error(
      {
        status: mapped.status,
        code: mapped.code,
        message: redactSecrets(mapped.message, secretValues()),
        durationMs: Date.now() - startedAt
      },
      'service request failed'
    )
    await replyJson(mapped.status, failure(mapped.code, mapped.message))
  }
}

function matchConnectionRoute(pathname: string): {
  connectionId: string
  action?: 'refresh' | 'test-models' | 'models'
  modelId?: string
} | null {
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

function credentialValues(value: unknown, paths: string[]): string[] {
  const values: string[] = []
  for (const path of paths) {
    let current = value
    for (const segment of path.split('.')) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[segment]
    }
    if (typeof current === 'string' && current.length > 0) values.push(current)
  }
  return values
}

function redactSecrets(text: string, secrets: string[]): string {
  return secrets.reduce((sanitized, secret) => sanitized.split(secret).join('[redacted]'), text)
}
