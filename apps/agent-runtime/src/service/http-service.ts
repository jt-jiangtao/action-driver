import {
  ModelServiceError,
  type ModelAddRequestDto,
  type ModelConnectionDto,
  type ModelConnectionDraftDto,
  type ModelConnectionTestRequestDto,
  type ModelConnectionTestResultDto,
  type ModelFailureCode,
  type ModelOptionDto,
  type ModelImageCapabilityRequestDto,
  type ModelSetEnabledRequestDto,
  type ModelTestRequestDto,
  type ModelTestResultDto
} from '@actiondriver/model-connections'
import { getRequestListener } from '@hono/node-server'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  startBestEffortInteraction,
  type InteractionLogRecorder,
  type StructuredLogger,
  withRemoteTraceparent
} from '@actiondriver/observability'
import { z } from 'zod'
import type { ModelRef } from '@actiondriver/contracts'
import { attachServiceWebSocketServer, type ServiceStreamSessionPort } from './websocket-service'
import { attachLocalCapabilityService } from './local-capability-service'
import type { RuntimeSkillRegistry } from '../skill-registry'
import { AgentFileStoreError } from '../agent-files/agent-file-store'
import type { AgentFileStore } from '../agent-files/agent-file-store'
import type { SkillInstaller } from '../agent-files/skill-installer'
import type { AgentFileErrorCode } from '@actiondriver/runtime-contracts'
import { AssetError, MAX_IMAGE_BYTES, type SessionAssetStore } from '../media/session-asset-store'

export type { ServiceStreamSessionPort } from './websocket-service'

export const SERVICE_PROTOCOL_VERSION = 1

export type ServiceModelConnectionPort = {
  list(): Promise<ModelConnectionDto[]>
  testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto>
  discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]>
  refresh(connectionId: string): Promise<ModelOptionDto[]>
  testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]>
  testConnectionModels(request: ModelConnectionTestRequestDto): Promise<ModelTestResultDto[]>
  setModelEnabled(request: ModelSetEnabledRequestDto): Promise<void>
  setModelImageCapability(request: ModelImageCapabilityRequestDto): Promise<void>
  setDefaultImageModel(model: ModelRef | null): Promise<void>
  getDefaultImageModel(): Promise<ModelRef | null>
  add(request: ModelAddRequestDto): Promise<ModelConnectionDto>
  delete(connectionId: string): Promise<void>
}

export type ServiceHttpOptions = {
  service: ServiceModelConnectionPort
  agentFiles?: AgentFileStore
  skillInstaller?: SkillInstaller
  taskControl?: { execute(command: string, input: unknown): Promise<unknown> }
  token: string
  runtimeVersion: string
  logger?: StructuredLogger
  host?: string
  port?: number
  bodyLimitBytes?: number
  interactions?: InteractionLogRecorder
  streamSessions?: ServiceStreamSessionPort
  skillRegistry?: RuntimeSkillRegistry
  assets?: SessionAssetStore
  rendererOrigin?: string
  streamMaxPayloadBytes?: number
  streamMaxBufferedBytes?: number
}

export type ServiceHttpServer = {
  url: string
  port: number
  close(): Promise<void>
}

type Envelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ModelFailureCode | AgentFileErrorCode | string; message: string } }

const id = z.string().trim().min(1)
const draftSchema = z
  .object({
    name: id,
    protocol: z.enum(['openai-compatible', 'anthropic']),
    baseUrl: z.url(),
    apiKey: id
  })
  .strict()
const modelSchema = z
  .object({
    id,
    name: id,
    enabled: z.boolean(),
    testState: z.enum(['untested', 'testing', 'success', 'failed', 'unsupported']),
    imageInputEnabled: z.boolean().optional(),
    imageGenerationEnabled: z.boolean().optional()
  })
  .strict()
const addSchema = z.object({ draft: draftSchema, models: z.array(modelSchema) }).strict()
const testModelsSchema = z.object({ draft: draftSchema, modelIds: z.array(id) }).strict()
const connectionModelsSchema = z.object({ modelIds: z.array(id) }).strict()
const enabledSchema = z.object({ enabled: z.boolean() }).strict()
const imageCapabilitySchema = z
  .object({
    kind: z.enum(['input', 'generation']),
    enabled: z.boolean()
  })
  .strict()
const imageModelSchema = z.object({ connectionId: id, modelId: id }).strict()
const defaultImageModelSchema = z.object({ model: imageModelSchema.nullable() }).strict()
const saveAgentFileSchema = z.object({ path: id, content: z.string(), expectedDigest: id }).strict()
const createAgentSkillSchema = z.object({ name: id, description: z.string() }).strict()
const installSkillSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('local'), path: id }).strict(),
  z.object({ source: z.literal('github'), url: z.url() }).strict()
])
const renameAgentSkillSchema = z.object({ name: id }).strict()
const resetPromptSchema = z.object({ expectedDigest: id }).strict()
const taskInputSchema = z.object({ value: z.unknown() }).strict()
const skillControlSchema = z.object({ command: z.enum(['pause', 'resume', 'take-over']) }).strict()
const invalid = () => failure('invalid-request', 'Request body does not match the route schema')
const validate = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, context) => {
    if (!result.success) return context.json(invalid(), 400)
  })

export function createServiceHttpApp(options: ServiceHttpOptions): Hono {
  const app = new Hono()
  const tokenDigest = createHash('sha256').update(options.token).digest()
  const logger = options.logger ?? null
  const bodyLimit = options.bodyLimitBytes ?? 1_000_000

  app.onError((error, context) => {
    const mapped =
      error instanceof ModelServiceError
        ? { status: 200 as const, code: error.code, message: error.message }
        : error instanceof AssetError
          ? {
              status:
                error.code === 'ASSET_NOT_FOUND' || error.code === 'ASSET_SESSION_MISMATCH'
                  ? (404 as const)
                  : (400 as const),
              code: error.code,
              message: error.message
            }
          : error instanceof AgentFileStoreError
            ? {
                status:
                  error.code === 'NOT_FOUND'
                    ? (404 as const)
                    : error.code === 'CONFLICT'
                      ? (409 as const)
                      : (400 as const),
                code: error.code,
                message: error.message
              }
            : {
                status: 500 as const,
                code: 'unknown' as const,
                message: error instanceof Error ? error.message : String(error)
              }
    return context.json(failure(mapped.code, mapped.message), mapped.status)
  })

  app.use('*', async (context, next) => {
    const startedAt = Date.now()
    const method = context.req.method
    const path = context.req.path
    const binaryUpload = method === 'POST' && path === '/assets/staged'
    const binaryDownload = method === 'GET' && /^\/sessions\/[^/]+\/assets\/[^/]+$/.test(path)
    const requestLog = logger?.child({ transport: 'http', method, path })
    const origin = context.req.header('origin')
    const trustedRendererOrigin = options.rendererOrigin
    const originRejected = origin !== undefined && origin !== trustedRendererOrigin
    if (method === 'OPTIONS' && origin === trustedRendererOrigin && origin !== undefined) {
      const requestedMethod = context.req.header('access-control-request-method')?.toUpperCase()
      const requestedHeaders =
        context.req
          .header('access-control-request-headers')
          ?.split(',')
          .map((header) => header.trim().toLowerCase()) ?? []
      if (
        !requestedMethod ||
        !['GET', 'POST', 'DELETE'].includes(requestedMethod) ||
        requestedHeaders.some((header) => !['authorization', 'content-type'].includes(header))
      ) {
        return context.json(failure('unauthorized', 'Preflight request is not allowed'), 403)
      }
      return context.body(null, 204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      })
    }
    const authRejected =
      path !== '/readyz' &&
      path !== '/healthz' &&
      !tokenMatches(bearerToken(context.req.header('authorization')), tokenDigest)
    let requestBody: unknown = null
    let bodyError: string | null = null
    if (
      !originRejected &&
      !authRejected &&
      !binaryUpload &&
      (method === 'POST' || method === 'PUT' || method === 'PATCH')
    ) {
      const raw = await readLimitedBody(context.req.raw.clone(), bodyLimit)
      if (raw === null) bodyError = 'Request body is too large'
      else if (raw.trim()) {
        try {
          requestBody = JSON.parse(raw) as unknown
        } catch {
          bodyError = 'Request body must be valid JSON'
        }
      }
    }
    const secretValues = credentialValues(requestBody, ['apiKey', 'draft.apiKey'])
    const finish = options.interactions
      ? await startBestEffortInteraction(
          options.interactions,
          {
            transport: 'http',
            direction: 'renderer->service',
            operation: method + ' ' + path,
            startedAt,
            request: {
              kind: 'json',
              value: {
                method,
                path,
                query: Object.fromEntries(new URL(context.req.url).searchParams),
                headers: Object.fromEntries(context.req.raw.headers),
                body: binaryUpload
                  ? {
                      kind: 'binary-image',
                      mimeType: context.req.header('content-type') ?? null,
                      byteLength: context.req.header('content-length') ?? null
                    }
                  : requestBody
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
      : null

    if (originRejected) {
      requestLog?.warn({ status: 403, reason: 'origin-rejected' }, 'service request rejected')
      context.res = context.json(failure('unauthorized', 'Browser origins are not allowed'), 403)
    } else if (authRejected) {
      requestLog?.warn({ status: 401, reason: 'unauthorized' }, 'service request rejected')
      context.res = context.json(
        failure('unauthorized', 'A valid service credential is required'),
        401
      )
    } else if (bodyError) {
      context.res = context.json(failure('invalid-request', bodyError), 400)
    } else {
      requestLog?.info({ status: 'accepted' }, 'service request received')
      await next()
    }

    if (origin !== undefined && !originRejected) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Vary', 'Origin')
    }

    const responseText = binaryDownload && context.res.ok ? '' : await context.res.clone().text()
    let responseValue: unknown
    if (binaryDownload && context.res.ok) {
      responseValue = {
        kind: 'binary-image',
        mimeType: context.res.headers.get('content-type'),
        byteLength: context.res.headers.get('content-length')
      }
    } else
      try {
        responseValue = JSON.parse(responseText) as unknown
      } catch {
        responseValue = responseText
      }
    const envelope = isRecord(responseValue) ? responseValue : null
    const failed = envelope?.ok === false
    const outcome: 'error' | 'ok' = context.res.status >= 400 || failed ? 'error' : 'ok'
    const error = failed && isRecord(envelope.error) ? envelope.error : null
    const interactionError =
      error && typeof error.code === 'string' && typeof error.message === 'string'
        ? { code: error.code, message: error.message }
        : null
    await finish?.({
      outcome,
      status: context.res.status,
      response:
        typeof responseValue === 'string'
          ? {
              kind: 'text',
              text: responseValue,
              contentType: context.res.headers.get('content-type') ?? 'text/plain'
            }
          : { kind: 'json', value: responseValue },
      secretValues,
      ...(interactionError ? { error: interactionError } : {})
    })
    const loggedMessage =
      error && typeof error.message === 'string'
        ? redactSecrets(error.message, secretValues)
        : undefined
    if (outcome === 'error') {
      requestLog?.error(
        {
          status: context.res.status,
          ...(error && typeof error.code === 'string' ? { code: error.code } : {}),
          ...(loggedMessage ? { message: loggedMessage } : {}),
          durationMs: Date.now() - startedAt
        },
        'service request failed'
      )
    } else {
      requestLog?.info(
        { status: context.res.status, durationMs: Date.now() - startedAt },
        'service response'
      )
    }
  })

  app.get('/readyz', (context) => context.text('ok'))
  app.get('/healthz', (context) => context.text('ok'))
  app.get('/version', (context) =>
    context.json(
      success({
        runtimeVersion: options.runtimeVersion,
        protocolVersion: SERVICE_PROTOCOL_VERSION
      })
    )
  )
  if (options.assets) {
    app.post('/assets/staged', async (context) => {
      const bytes = await readLimitedBytes(context.req.raw, MAX_IMAGE_BYTES)
      if (!bytes) return context.json(failure('invalid-request', 'Image is too large'), 413)
      return context.json(success(await options.assets!.stageUpload(bytes)))
    })
    app.get('/sessions/:sessionId/assets/:assetId', async (context) => {
      const { bytes, mimeType } = await options.assets!.read(
        context.req.param('assetId'),
        context.req.param('sessionId')
      )
      return context.body(new Uint8Array(bytes), 200, {
        'Content-Type': mimeType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      })
    })
  }
  app.get('/model-connections', async (context) =>
    context.json(success(await options.service.list()))
  )
  app.get('/model-connections/default-image-model', async (context) =>
    context.json(success(await options.service.getDefaultImageModel()))
  )
  app.post(
    '/model-connections/default-image-model',
    validate(defaultImageModelSchema),
    async (context) => {
      await options.service.setDefaultImageModel(context.req.valid('json').model)
      return context.json(success(null))
    }
  )
  app.post('/model-connections', validate(addSchema), async (context) =>
    context.json(success(await options.service.add(context.req.valid('json'))))
  )
  app.post('/model-connections/test', validate(draftSchema), async (context) =>
    context.json(success(await options.service.testConnection(context.req.valid('json'))))
  )
  app.post('/model-connections/discover', validate(draftSchema), async (context) =>
    context.json(success(await options.service.discover(context.req.valid('json'))))
  )
  app.post('/model-connections/test-models', validate(testModelsSchema), async (context) =>
    context.json(success(await options.service.testModels(context.req.valid('json'))))
  )
  app.post('/model-connections/:connectionId/refresh', async (context) =>
    context.json(success(await options.service.refresh(context.req.param('connectionId'))))
  )
  app.post(
    '/model-connections/:connectionId/test-models',
    validate(connectionModelsSchema),
    async (context) =>
      context.json(
        success(
          await options.service.testConnectionModels({
            connectionId: context.req.param('connectionId'),
            modelIds: context.req.valid('json').modelIds
          })
        )
      )
  )
  app.post(
    '/model-connections/:connectionId/models/:modelId',
    validate(enabledSchema),
    async (context) => {
      await options.service.setModelEnabled({
        connectionId: context.req.param('connectionId'),
        modelId: context.req.param('modelId'),
        enabled: context.req.valid('json').enabled
      })
      return context.json(success(null))
    }
  )
  app.post(
    '/model-connections/:connectionId/models/:modelId/image-capability',
    validate(imageCapabilitySchema),
    async (context) => {
      await options.service.setModelImageCapability({
        connectionId: context.req.param('connectionId'),
        modelId: context.req.param('modelId'),
        ...context.req.valid('json')
      })
      return context.json(success(null))
    }
  )
  app.delete('/model-connections/:connectionId', async (context) => {
    await options.service.delete(context.req.param('connectionId'))
    return context.json(success(null))
  })
  if (options.agentFiles) {
    const files = options.agentFiles
    app.get('/agent-files/main-prompt', async (context) =>
      context.json(success(await files.getMainPrompt()))
    )
    app.post('/agent-files/main-prompt/reset', validate(resetPromptSchema), async (context) =>
      context.json(success(await files.resetMainPrompt(context.req.valid('json').expectedDigest)))
    )
    app.get('/agent-files/skills', async (context) =>
      context.json(success(await files.listSkills()))
    )
    if (options.skillInstaller) {
      app.post('/agent-files/skills/install', validate(installSkillSchema), async (context) =>
        context.json(success(await options.skillInstaller!.installSkill(context.req.valid('json'))))
      )
    }
    app.get('/agent-files/skills/:skillId/tree', async (context) =>
      context.json(success(await files.getSkillTree(context.req.param('skillId'))))
    )
    app.post('/agent-files/skills', validate(createAgentSkillSchema), async (context) =>
      context.json(success(await files.createSkill(context.req.valid('json'))))
    )
    app.post(
      '/agent-files/skills/:skillId/rename',
      validate(renameAgentSkillSchema),
      async (context) =>
        context.json(
          success(
            await files.renameSkill(context.req.param('skillId'), context.req.valid('json').name)
          )
        )
    )
    app.delete('/agent-files/skills/:skillId', async (context) => {
      await files.deleteSkill(context.req.param('skillId'))
      return context.json(success(null))
    })
    app.post('/agent-files/skills/:skillId/enabled', validate(enabledSchema), async (context) =>
      context.json(
        success(
          await files.setSkillEnabled(
            context.req.param('skillId'),
            context.req.valid('json').enabled
          )
        )
      )
    )
    app.get('/agent-files/file', async (context) => {
      const path = context.req.query('path')
      if (!path) return context.json(invalid(), 400)
      return context.json(success(await files.readFile(path)))
    })
    app.post('/agent-files/file', validate(saveAgentFileSchema), async (context) =>
      context.json(success(await files.saveFile(context.req.valid('json'))))
    )
  }
  if (options.taskControl) {
    const tasks = options.taskControl
    app.get('/tasks', async (context) => {
      const limit = Number(context.req.query('limit') ?? 20)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return context.json(invalid(), 400)
      }
      return context.json(success(await tasks.execute('task.list', { limit })))
    })
    app.get('/tasks/:taskId', async (context) =>
      context.json(
        success(await tasks.execute('task.get', { taskId: context.req.param('taskId') }))
      )
    )
    app.post('/tasks/:taskId/interrupt', async (context) =>
      context.json(
        success(await tasks.execute('task.interrupt', { taskId: context.req.param('taskId') }))
      )
    )
    app.post('/tasks/:taskId/continue', async (context) =>
      context.json(
        success(await tasks.execute('task.continue', { taskId: context.req.param('taskId') }))
      )
    )
    app.post('/tasks/:taskId/input', validate(taskInputSchema), async (context) =>
      context.json(
        success(
          await tasks.execute('task.provide-input', {
            taskId: context.req.param('taskId'),
            value: context.req.valid('json').value
          })
        )
      )
    )
    app.post(
      '/skills/invocations/:invocationId/control',
      validate(skillControlSchema),
      async (context) =>
        context.json(
          success(
            await tasks.execute('skill.control', {
              invocationId: context.req.param('invocationId'),
              command: context.req.valid('json').command
            })
          )
        )
    )
  }
  app.notFound((context) =>
    context.json(
      failure('not-found', 'Unknown route: ' + context.req.method + ' ' + context.req.path),
      404
    )
  )
  return app
}

export async function startServiceHttpServer(
  options: ServiceHttpOptions
): Promise<ServiceHttpServer> {
  const host = options.host ?? '127.0.0.1'
  const app = createServiceHttpApp(options)
  const listen = getRequestListener(app.fetch, { overrideGlobalObjects: false })
  const server = createServer((request, response) => {
    const parent = request.headers.traceparent
    const run = () => listen(request, response)
    void (typeof parent === 'string' ? withRemoteTraceparent(parent, run) : run())
  })
  const tokenDigest = createHash('sha256').update(options.token).digest()
  const webSockets = options.streamSessions
    ? attachServiceWebSocketServer(server, {
        sessions: options.streamSessions,
        tokenMatches: (token) => tokenMatches(token, tokenDigest),
        logger: options.logger ?? null,
        allowCapabilityUpgrade: options.skillRegistry !== undefined,
        ...(options.interactions ? { interactions: options.interactions } : {}),
        ...(options.rendererOrigin ? { rendererOrigin: options.rendererOrigin } : {}),
        ...(options.streamMaxPayloadBytes === undefined
          ? {}
          : { maxPayloadBytes: options.streamMaxPayloadBytes }),
        ...(options.streamMaxBufferedBytes === undefined
          ? {}
          : { maxBufferedBytes: options.streamMaxBufferedBytes })
      })
    : null
  const localCapabilities = options.skillRegistry
    ? attachLocalCapabilityService(server, {
        registry: options.skillRegistry,
        tokenMatches: (token) => tokenMatches(token, tokenDigest)
      })
    : null

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
    url: 'http://' + host + ':' + address.port,
    port: address.port,
    close: async () => {
      await webSockets?.close()
      await localCapabilities?.close()
      await closeServer(server)
    }
  }
}

function bearerToken(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

async function readLimitedBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  } finally {
    reader.releaseLock()
  }
}

async function readLimitedBytes(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    reader.releaseLock()
  }
}

function tokenMatches(token: string, tokenDigest: Buffer): boolean {
  const presented = createHash('sha256').update(token).digest()
  return presented.length === tokenDigest.length && timingSafeEqual(presented, tokenDigest)
}

function success<T>(value: T): Envelope<T> {
  return { ok: true, value }
}

function failure(
  code: ModelFailureCode | AgentFileErrorCode | string,
  message: string
): Envelope<never> {
  return { ok: false, error: { code, message } }
}

function credentialValues(value: unknown, paths: string[]): string[] {
  const values: string[] = []
  for (const path of paths) {
    let current = value
    for (const segment of path.split('.')) {
      if (!isRecord(current)) {
        current = undefined
        break
      }
      current = current[segment]
    }
    if (typeof current === 'string' && current.length > 0) values.push(current)
  }
  return values
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function redactSecrets(text: string, secrets: string[]): string {
  return secrets.reduce((sanitized, secret) => sanitized.split(secret).join('[redacted]'), text)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
