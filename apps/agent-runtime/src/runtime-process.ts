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
import { createWorkspaceDependenciesTool } from './execution/workspace-dependencies-tool'
import { SessionExecutionContextResolver } from './execution/session-execution-context'
import { SessionSandbox } from './execution/session-sandbox'
import { SessionWorkspaceStore } from './execution/session-workspace'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerSearxngTool } from './searxng/runtime-tools'
import { registerWebOpenTool } from './web-open/tool'
import { AgentFileStore } from './agent-files/agent-file-store'
import { SkillInstaller } from './agent-files/skill-installer'
import { createSkillRuntimeTools } from './agent-files/runtime-tools'
import type { RuntimeSkillRegistry } from './skill-registry'
import { SessionAssetStore } from './media/session-asset-store'
import { SessionInputFileStore } from './media/session-input-file-store'
import { SessionOutputStore } from './media/session-output-store'
import { createImageGenerationTool } from './media/image-generation-tool'

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
  const agentHome = environment.ACTIONDRIVER_AGENT_HOME?.trim() || workspaceRoot
  // Scripts may read the installed Skills they were told to run, next to the
  // bundled runtimes, and nothing else.
  const sandbox = new SessionSandbox({
    runtimeRoots: [runtimeDist, join(agentHome, '.action-driver', 'skills')]
  })
  const scriptTools = await createScriptTools({
    runtimeDist,
    sandbox,
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
  const assets = new SessionAssetStore({ database, rootDirectory: dirname(databasePath) })
  const workspaces = new SessionWorkspaceStore({ workspaceRoot })
  const inputFiles = new SessionInputFileStore({
    database,
    rootDirectory: dirname(databasePath),
    workspaces
  })
  const outputs = new SessionOutputStore({
    database,
    rootDirectory: dirname(databasePath),
    workspaces
  })
  await assets.cleanExpiredStaged(24 * 60 * 60 * 1000)
  await assets.cleanOrphanFiles()
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
    transport: createFetchHttpTransport(),
    imageResolver: (asset) => assets.read(asset.assetId, asset.sessionId)
  })
  const modelTraces = new PhoenixModelObservability(logging.tracer)
  const executionContexts = new SessionExecutionContextResolver({
    tasks: repositories.tasks,
    workspaceRoot
  })
  const agentFiles = new AgentFileStore({
    homeDirectory: agentHome,
    systemSkillsSourceRoot: resolve(
      runtimeEntry.endsWith('.ts') ? dirname(runtimeEntry) : runtimeDist,
      runtimeEntry.endsWith('.ts') ? '../resources/system-skills' : 'system-skills'
    )
  })
  await agentFiles.initialize()
  const skillInstaller = new SkillInstaller({
    homeDirectory: agentHome,
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
    interactions,
    executionContext: (taskId) => executionContexts.resolve(taskId)
  })
  for (const tool of scriptTools) {
    local.toolRuntime.registry.register(tool.definition, tool.executor)
    local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
  }
  const workspaceDependenciesTool = createWorkspaceDependenciesTool(runtimeDist)
  local.toolRuntime.registry.register(workspaceDependenciesTool.definition, workspaceDependenciesTool.executor)
  local.toolRuntime.grants.push(`${workspaceDependenciesTool.definition.id}@${workspaceDependenciesTool.definition.version}`)
  const imageTool = createImageGenerationTool({
    defaultModel: () => service.getDefaultImageModel(),
    generate: (request, signal) => service.generateImage(request, signal),
    assets,
    sessionForTask: async (taskId) => (await repositories.tasks.get(taskId))?.sessionId ?? null
  })
  local.toolRuntime.registry.register(imageTool.definition, imageTool.executor)
  local.toolRuntime.grants.push(`${imageTool.definition.id}@${imageTool.definition.version}`)
  local.toolRuntime.isAvailable = async (definition) =>
    definition.id !== imageTool.definition.id || (await service.getDefaultImageModel()) !== null
  local.toolRuntime.capabilityNotice = async () =>
    (await service.getDefaultImageModel()) === null
      ? '本应用支持图片生成，但当前没有配置默认生图模型。若用户请求生成图片，请说明需前往“设置 → 模型连接”启用一个模型的图片生成能力并设为默认模型；不要说应用完全没有生图工具。'
      : null
  registerSearxngTool(local.toolRuntime, environment.ACTIONDRIVER_SEARXNG_ENDPOINT)
  registerWebOpenTool(local.toolRuntime)
  for (const tool of createSkillRuntimeTools({ store: agentFiles, installer: skillInstaller })) {
    local.toolRuntime.registry.register(tool.definition, tool.executor)
    local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
  }
  const streamSessions = new StreamSessionService({
    repositories,
    assets,
    inputFiles,
    outputs,
    listOutputs: (taskId) => outputs.listByTask(taskId),
    describeSessionInputs: async (sessionId) => {
      const files = await repositories.inputFiles.listBySession(sessionId)
      const described: Array<{ name: string; path: string; mimeType: string }> = []
      for (const file of files) {
        if (file.status !== 'bound' || !file.relativePath) continue
        const path = await workspaces
          .resolveFile(sessionId, 'input', file.relativePath.replace(/^input\//, ''), {
            mustBeRegularFile: true
          })
          .catch(() => null)
        if (path) described.push({ name: file.name, path, mimeType: file.mimeType })
      }
      return described
    },
    graphRunner: local.adapters.graphRunner,
    ids: local.adapters.idGenerator,
    now: () => local.adapters.clock.now(),
    listEnabledSkills: () => agentFiles.listEnabledSkillDescriptions(),
    rawToolIO: { enabled: true }
  })
  const server = createLocalRuntimeServer({
    adapters: local.adapters,
    messages: repositories.messages,
    streamSnapshots: streamSessions,
    outputFiles: (taskId) => outputs.listByTask(taskId)
  })

  let httpServer: ServiceHttpServer | null = null

  if (serviceToken) {
    httpServer = await startServiceHttpServer({
      service,
      assets,
      inputFiles,
      outputs,
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
