import { createLocalRuntimeServer } from './local-runtime-server'
import { createLocalRuntimeAdapters } from './local-adapters'
import type { ParentPortLike } from './runtime-parent-port'
import { openRuntimeDatabase } from './database'
import { claimRuntimeOwnership } from './runtime-ownership'
import { SqliteRuntimeRepositories } from './repositories'
import { createSqliteCheckpointer } from './sqlite-checkpointer'
import { ConnectionModelGateway } from './model-connections/model-gateway'
import { PhoenixModelObservability } from './phoenix-model-observability'
import { createSqliteModelConnectionStore } from './model-connections/sqlite-store'
import { createCredentialCipher, createCredentialKey } from './model-connections/credential-cipher'
import { createServiceLogger } from './service/logger'
import { startServiceHttpServer, type ServiceHttpServer } from './service/http-service'
import { StreamSessionService } from './stream-session-service'
import { SERVICE_STREAM_PATH, SERVICE_STREAM_PROTOCOL } from './service/websocket-service'
import { createFetchHttpTransport } from './model-connections/http-transport'
import { ModelConnectionService } from './model-connections/service'
import { createInteractionLogRecorder } from '@actiondriver/observability'
import { randomUUID } from 'node:crypto'
import { createScriptTools } from './execution/tools'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSearxngTool } from './searxng/runtime-tools'
import { AgentFileStore } from './agent-files/agent-file-store'
import { SkillInstaller } from './agent-files/skill-installer'
import { createSkillRuntimeTools } from './agent-files/runtime-tools'
import type { RuntimeSkillRegistry } from './skill-registry'

type ParentMessageEvent = { data: unknown }

export async function startAgentRuntimeProcess(
  parentPort: ParentPortLike,
  databasePath: string,
  exit: (code: number) => void = process.exit,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const workspaceRoot = environment.ACTIONDRIVER_WORKSPACE_ROOT?.trim()
  if (!workspaceRoot) throw new Error('SANDBOX_ROOT_INVALID: workspace root is required')
  // LangGraph remains in use, but inherited LangChain flags must not enable its LangSmith exporter.
  for (const key of [
    'LANGSMITH_TRACING_V2',
    'LANGCHAIN_TRACING_V2',
    'LANGSMITH_TRACING',
    'LANGCHAIN_TRACING'
  ])
    process.env[key] = 'false'
  const runtimeEntry = fileURLToPath(import.meta.url)
  const runtimeDist = resolve(dirname(runtimeEntry), runtimeEntry.endsWith('.ts') ? '../dist' : '.')
  const timeoutOverride = Number(environment.ACTIONDRIVER_SCRIPT_TIMEOUT_MS)
  const scriptTools = await createScriptTools({
    workspaceRoot,
    runtimeDist,
    ...(Number.isSafeInteger(timeoutOverride) &&
    timeoutOverride >= 1_000 &&
    timeoutOverride <= 600_000
      ? { timeoutMs: timeoutOverride }
      : {})
  })
  const serviceToken = environment.ACTIONDRIVER_SERVICE_TOKEN?.trim()
  const database = openRuntimeDatabase(databasePath)
  let ownership: ReturnType<typeof claimRuntimeOwnership>
  try {
    ownership = claimRuntimeOwnership(database)
  } catch (error) {
    database.close()
    throw error
  }
  const repositories = new SqliteRuntimeRepositories(database)
  await repositories.cancelLegacyPendingApprovals('TOOL_APPROVAL_REMOVED')
  await repositories.recoverInterruptedRequests('RUNTIME_RESTARTED')
  const checkpointer = createSqliteCheckpointer(databasePath)
  const logging = createServiceLogger({ databasePath })
  const interactions = createInteractionLogRecorder({
    ids: {
      eventId: () => `service:${randomUUID()}`,
      correlationId: randomUUID
    },
    logger: logging.logger,
    tracer: logging.tracer,
    meter: logging.meter
  })
  const credentialSecret = environment.ACTIONDRIVER_CREDENTIAL_KEY?.trim()
  const service = new ModelConnectionService({
    store: createSqliteModelConnectionStore(database),
    cipher: createCredentialCipher(
      credentialSecret ? createCredentialKey(credentialSecret) : Buffer.alloc(0)
    ),
    transport: createFetchHttpTransport()
  })
  const modelTraces = new PhoenixModelObservability(logging.tracer)
  const agentFiles = new AgentFileStore({
    homeDirectory: environment.ACTIONDRIVER_AGENT_HOME?.trim() || workspaceRoot,
    systemSkillsSourceRoot: resolve(
      runtimeEntry.endsWith('.ts') ? dirname(runtimeEntry) : runtimeDist,
      runtimeEntry.endsWith('.ts') ? '../resources/system-skills' : 'system-skills'
    )
  })
  await agentFiles.initialize()
  const skillInstaller = new SkillInstaller({
    homeDirectory: environment.ACTIONDRIVER_AGENT_HOME?.trim() || workspaceRoot,
    store: agentFiles
  })
  const modelGateway = new ConnectionModelGateway({
    service,
    interactions,
    traces: modelTraces,
    correlationId: randomUUID,
    now: () => new Date().toISOString()
  })
  const local = createLocalRuntimeAdapters({
    repositories,
    checkpointer,
    modelGateway,
    interactions
  })
  for (const tool of scriptTools) {
    local.toolRuntime.registry.register(tool.definition, tool.executor)
    local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
  }
  registerSearxngTool(local.toolRuntime, environment.ACTIONDRIVER_SEARXNG_ENDPOINT)
  for (const tool of createSkillRuntimeTools({ store: agentFiles, installer: skillInstaller })) {
    local.toolRuntime.registry.register(tool.definition, tool.executor)
    local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
  }
  const streamSessions = new StreamSessionService({
    repositories,
    graphRunner: local.adapters.graphRunner,
    ids: local.adapters.idGenerator,
    now: () => local.adapters.clock.now(),
    listEnabledSkills: () => agentFiles.listEnabledSkillDescriptions(),
    rawToolIO: { enabled: true }
  })
  const server = createLocalRuntimeServer({
    adapters: local.adapters,
    messages: repositories.messages,
    streamSnapshots: streamSessions
  })

  let httpServer: ServiceHttpServer | null = null

  if (serviceToken) {
    httpServer = await startServiceHttpServer({
      service,
      agentFiles,
      skillInstaller,
      taskControl: server,
      token: serviceToken,
      runtimeVersion: environment.ACTIONDRIVER_RUNTIME_VERSION ?? '0.1.0',
      logger: logging.logger,
      interactions,
      streamSessions,
      skillRegistry: local.adapters.skillRegistry as RuntimeSkillRegistry,
      ...(environment.ACTIONDRIVER_RENDERER_ORIGIN?.trim()
        ? { rendererOrigin: environment.ACTIONDRIVER_RENDERER_ORIGIN.trim() }
        : {})
    })
  }

  const handleShutdown = (event: ParentMessageEvent) => {
    if (
      typeof event.data !== 'object' ||
      event.data === null ||
      !('type' in event.data) ||
      event.data.type !== 'runtime.shutdown'
    ) {
      return
    }
    parentPort.off('message', handleShutdown)
    void server.close().then(async () => {
      await httpServer?.close()
      checkpointer.close()
      ownership.release()
      repositories.close()
      await logging.close()
      exit(0)
    })
  }

  parentPort.on('message', handleShutdown)
  parentPort.postMessage({
    type: 'runtime.ready',
    service: httpServer
      ? {
          baseUrl: httpServer.url,
          streamPath: SERVICE_STREAM_PATH,
          streamProtocol: SERVICE_STREAM_PROTOCOL
        }
      : null
  })
}
