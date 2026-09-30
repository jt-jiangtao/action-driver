import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { createServer, type Server } from 'node:http'
import {
  withRemoteTraceparent,
  type InteractionLogRecorder,
  type StructuredLogger
} from '@action-driver/observability'
import {
  attachServiceWebSocketServer,
  type ServiceStreamSessionPort
} from './websocket-service'
import { attachLocalCapabilityService } from './local-capability-service'
import type { RuntimeSkillRegistry } from '../skill-registry'
import type { AgentFileStore } from '../agent-files/agent-file-store'
import type { SkillInstaller } from '../agent-files/skill-installer'
import type { VolatileComputerImages } from '../computer-use/volatile-images'
import type { SessionAssetStore } from '../media/session-asset-store'
import type { SessionInputFileStore } from '../media/session-input-file-store'
import type { SessionOutputStore } from '../media/session-output-store'
import { failure } from './http/http-contract'
import { mapErrorToResponse } from './http/http-errors'
import type { ModelConnectionRoutes } from './http/http-routes-models'
import { registerMediaRoutes } from './http/http-routes-media'
import { registerModelConnectionRoutes } from './http/http-routes-models'
import { registerAgentFileRoutes } from './http/http-routes-agent-files'
import { registerPluginRoutes, type PluginInterfaceRoutes } from './http/http-routes-plugin'
import { registerPlacementRoutes, type PlacementRoutesPort } from '../placement/routes'
import { registerResourceRoutes, type ResourceRoutesPort } from './http/http-routes-resources'
import { registerServiceMetadataRoutes } from './http/http-routes-service'
import { registerTaskRoutes } from './http/http-routes-tasks'
import { createRequestPolicyMiddleware } from './http/http-request-policy'
import { tokenDigest, tokenMatches } from './http/http-utils'

export type { ServiceStreamSessionPort } from './websocket-service'

export { SERVICE_PROTOCOL_VERSION } from './http/http-routes-service'

export type ServiceModelConnectionPort = ModelConnectionRoutes['service']

export type ServiceHttpOptions = {
  service: ServiceModelConnectionPort
  pluginInterface?: PluginInterfaceRoutes
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
  computerImages?: VolatileComputerImages
  assets?: SessionAssetStore
  inputFiles?: SessionInputFileStore
  outputs?: SessionOutputStore
  resourceRoutes?: ResourceRoutesPort
  placementRoutes?: PlacementRoutesPort
  rendererOrigin?: string
  streamMaxPayloadBytes?: number
  streamMaxBufferedBytes?: number
}

export type ServiceHttpServer = {
  url: string
  port: number
  close(): Promise<void>
}

export function createServiceHttpApp(options: ServiceHttpOptions): Hono {
  const app = new Hono()
  const digest = tokenDigest(options.token)

  app.onError((error, context) => {
    const mapped = mapErrorToResponse(error)
    return context.json(failure(mapped.code, mapped.message), mapped.status)
  })

  app.use(
    '*',
    createRequestPolicyMiddleware({
      tokenDigest: digest,
      bodyLimitBytes: options.bodyLimitBytes ?? 1_000_000,
      logger: options.logger ?? null,
      ...(options.interactions ? { interactions: options.interactions } : {}),
      ...(options.rendererOrigin ? { rendererOrigin: options.rendererOrigin } : {})
    })
  )

  if (options.pluginInterface) registerPluginRoutes(app, options.pluginInterface)
  registerServiceMetadataRoutes(app, { runtimeVersion: options.runtimeVersion })
  registerMediaRoutes(app, {
    ...(options.assets ? { assets: options.assets } : {}),
    ...(options.inputFiles ? { inputFiles: options.inputFiles } : {}),
    ...(options.outputs ? { outputs: options.outputs } : {})
  })
  registerModelConnectionRoutes(app, { service: options.service })
  if (options.agentFiles) {
    registerAgentFileRoutes(app, {
      agentFiles: options.agentFiles,
      ...(options.skillInstaller ? { skillInstaller: options.skillInstaller } : {})
    })
  }
  if (options.taskControl) registerTaskRoutes(app, { taskControl: options.taskControl })
  if (options.resourceRoutes) registerResourceRoutes(app, options.resourceRoutes)
  if (options.placementRoutes) registerPlacementRoutes(app, options.placementRoutes)
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
  const digest = tokenDigest(options.token)
  const webSockets = options.streamSessions
    ? attachServiceWebSocketServer(server, {
        sessions: options.streamSessions,
        tokenMatches: (token) => tokenMatches(token, digest),
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
        ...(options.computerImages ? { images: options.computerImages } : {}),
        tokenMatches: (token) => tokenMatches(token, digest)
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
