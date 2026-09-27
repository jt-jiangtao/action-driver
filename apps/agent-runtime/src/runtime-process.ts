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
import { parseSearxngEndpoint } from './searxng/search-tool'
import { createRuntimePluginPlatform } from './plugins/composition'
import { PluginInstructionHost } from './plugins/instruction-host'
import { createDesktopResourcePort } from './plugins/desktop-resource-port'
import { createCommandExecutionPort } from './plugins/command-port'
import { resolveExecutionRuntimePaths } from './execution/runtime-paths'
import { extractPageTextIsolated } from './web-open/extract-isolated'
import { PluginError } from '@actiondriver/plugin-contracts'
import { AgentFileStore } from './agent-files/agent-file-store'
import { SkillInstaller } from './agent-files/skill-installer'
import { createSkillStoragePorts } from './plugins/skill-port'
import type { RuntimeSkillRegistry } from './skill-registry'
import { SessionAssetStore } from './media/session-asset-store'
import { SessionInputFileStore } from './media/session-input-file-store'
import { SessionOutputStore } from './media/session-output-store'
import { definition as imageDefinition } from '@actiondriver/image-generation-plugin/catalog'
import { createComputerUseEntry } from './computer-use/entry'
import { VolatileComputerImages } from './computer-use/volatile-images'
import { ComputerUseControlGate } from './computer-use/control-gate'
import { LoadedSkills } from './computer-use/skill-gate'
import type { AppApprovalBroker } from './computer-use/app-approval-broker'
import { AppApprovalStore } from './computer-use/app-approval-store'

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
  const computerImages = new VolatileComputerImages()
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
    imageResolver: (asset) => asset.assetId.startsWith('volatile-computer:')
      ? Promise.resolve(computerImages.read(asset))
      : assets.read(asset.assetId, asset.sessionId)
  })
  const modelTraces = new PhoenixModelObservability(logging.tracer)
  const executionContexts = new SessionExecutionContextResolver({
    tasks: repositories.tasks,
    workspaceRoot
  })
  const pluginInstructions = new PluginInstructionHost(agentHome, ['computer-use', 'documents', 'pdf', 'presentations', 'spreadsheets', 'skill-creator', 'imagegen'])
  const agentFiles = new AgentFileStore({
    pluginSkills: pluginInstructions,
    homeDirectory: agentHome,
    systemSkillsSourceRoot: resolve(
      runtimeEntry.endsWith('.ts') ? dirname(runtimeEntry) : runtimeDist,
      runtimeEntry.endsWith('.ts') ? '../resources/system-skills' : 'system-skills'
    ),
    promptSourceRoot: resolve(
      runtimeEntry.endsWith('.ts') ? dirname(runtimeEntry) : runtimeDist,
      runtimeEntry.endsWith('.ts') ? '../resources/prompts' : 'prompts'
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
  local.toolRuntime.releaseVolatileImage = (assetId) => computerImages.discard(assetId)
  const computerControl = new ComputerUseControlGate()
  const loadedSkills = new LoadedSkills()
  let computer: Awaited<ReturnType<typeof createComputerUseEntry>> | null = null
  let appApprovals: AppApprovalBroker | undefined
  let approvalStore: AppApprovalStore | undefined
  if (process.platform === 'darwin') {
    const invokeComputer = async (input: Record<string, unknown>, signal?: AbortSignal) => {
      const provider = local.adapters.skillRegistry.resolve('computer-use', 1)
      const result = await provider.execute({ invocationId: randomUUID(), input }, signal)
      return result.input
    }
    approvalStore = new AppApprovalStore(database)
    // The model reaches the desktop only through the Codex js / js_reset entry; each app is
    // approved inside the call, and the turn's approvals and app leases end with the turn.
    // A broken Computer Use install (for example missing vendored docs) disables only Computer
    // Use; the rest of the runtime must still start.
    computer = await createComputerUseEntry({
      runtimeDist,
      vendorRoot: join(runtimeDist, 'vendor/codex-cua'),
      invoke: invokeComputer,
      control: computerControl,
      // Esc must stop the turn, not only the Computer Use session (2.11). The stream service owns
      // the per-request AbortController and is assigned below; this closure runs much later.
      stopTask: (taskId) => {
        void streamSessions.cancelTask(taskId)
      },
      skills: loadedSkills,
      images: computerImages,
      approvals: {
        isAlwaysAllowed: async (bundleId) => approvalStore!.isAllowed(bundleId),
        persistAlwaysAllowed: async (bundleId) => {
          approvalStore!.allow(bundleId)
        },
        emit: (event) => streamSessions.publishAppApproval(event)
      }
    }).catch((error: unknown) => {
      console.error('[runtime] Computer Use is unavailable', error)
      return null
    })
    if (computer) {
      appApprovals = computer.approvals
      for (const tool of computer.tools) {
        local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
      }
    }
  }
  for (const tool of scriptTools) {
    local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
  }
  const workspaceDependenciesTool = createWorkspaceDependenciesTool(runtimeDist)
  local.toolRuntime.grants.push(`${workspaceDependenciesTool.definition.id}@${workspaceDependenciesTool.definition.version}`)
  local.toolRuntime.grants.push(`${imageDefinition.id}@${imageDefinition.version}`)
  local.toolRuntime.isAvailable = async (definition) => {
    if (definition.id === imageDefinition.id)
      return (await service.getDefaultImageModel()) !== null
    if (definition.id.startsWith('tools.local.computer-use.')) {
      try { local.adapters.skillRegistry.resolve('computer-use', 1); return true }
      catch { return false }
    }
    return true
  }
  local.toolRuntime.capabilityNotice = async () =>
    (await service.getDefaultImageModel()) === null
      ? '本应用支持图片生成，但当前没有配置默认生图模型。若用户请求生成图片，请说明需前往“设置 → 模型连接”启用一个模型的图片生成能力并设为默认模型；不要说应用完全没有生图工具。'
      : null
  let computerActivated = false
  const searchEndpoint = environment.ACTIONDRIVER_SEARXNG_ENDPOINT?.trim()
  const runtimePaths = await resolveExecutionRuntimePaths(runtimeDist, process.arch, ['node'])
  const pluginPlatform = await createRuntimePluginPlatform({
    node: runtimePaths.node, hostEntry: join(runtimeDist, 'plugin-host.mjs'),
    packageRoots: ['command', 'web', 'image-generation', 'skills', 'documents', 'pdf', 'presentations', 'spreadsheets', ...(computer ? ['computer-use'] : [])].map(id => join(runtimeDist, 'plugins', id)),
    dataRoot: join(dirname(databasePath), 'plugins'), registry: local.toolRuntime.registry,
    retiredPluginIds: ['search', 'web-reader'],
    configuration: searchEndpoint ? { web: { endpoint: parseSearxngEndpoint(searchEndpoint) } } : {},
    skills: {
      stage: (owner, skill, root) => pluginInstructions.stage(owner, skill, root),
      publish: (owner, id) => { const registration = pluginInstructions.publish(owner, id); return { dispose: () => { loadedSkills.forget(id); return registration.dispose() } } }
    },
    desktopResources: createDesktopResourcePort(local.adapters.skillRegistry, randomUUID),
    toolTimeouts: Object.fromEntries(scriptTools.map(tool => [tool.definition.id, tool.definition.timeoutMs])),
    hostCapabilities: {
      ...createSkillStoragePorts({ store: agentFiles, installer: skillInstaller, contexts: executionContexts, record: (sessionId, skillId) => loadedSkills.record(sessionId, skillId) }),
      ...(computer ? { 'host.computer.execute': {
        plugins: ['computer-use'], grants: ['tools.local.computer-use.js@1', 'tools.local.computer-use.reset@1'],
        async start() {
          if (computerActivated) await computer!.restart()
          computerActivated = true
          return { dispose: () => computer!.dispose() }
        },
        stream: (input, context, signal) => createCommandExecutionPort(computer!.tools, executionContexts, ['computer-use']).stream(input, context, signal)
      } } : {}),
      'host.image.model': { plugins: ['image-generation'], grants: ['tools.local.image-generation.generate@1'], async invoke() {
        const model = await service.getDefaultImageModel()
        return model ? { ...model } : null
      } },
      'host.image.generate': { plugins: ['image-generation'], grants: ['tools.local.image-generation.generate@1'], async invoke(input, context, signal) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000 || !context.taskId) throw new PluginError('TOOL_INPUT_INVALID', 'Invalid image request')
        const task = await repositories.tasks.get(context.taskId)
        if (!task || task.sessionId !== context.sessionId) throw new PluginError('IMAGE_SESSION_NOT_FOUND', 'Image task has no owned session')
        const model = await service.getDefaultImageModel()
        if (!model) throw new PluginError('IMAGE_MODEL_NOT_CONFIGURED', 'No default image model')
        const selected = input.model
        if (!selected || typeof selected !== 'object' || Array.isArray(selected) || selected.connectionId !== model.connectionId || selected.modelId !== model.modelId) throw new PluginError('AUTHORIZATION_DENIED', 'Image model selection changed')
        const bytes = await service.generateImage({ model, prompt: input.prompt }, signal)
        signal.throwIfAborted()
        return { ...await assets.saveGenerated(task.sessionId, bytes) }
      } },
      'host.command.execute': createCommandExecutionPort([...scriptTools, workspaceDependenciesTool], executionContexts),
      'host.web.extract': { plugins: ['web'], grants: ['tools.local.web.open@1'], async invoke(input, _context, signal) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.html !== 'string' || Buffer.byteLength(input.html) > 4 * 1024 * 1024 || typeof input.url !== 'string' || input.url.length > 2048) throw new PluginError('TOOL_INPUT_INVALID', 'Invalid bounded HTML input')
        return { ...await extractPageTextIsolated(input.html, input.url, { signal }) }
      } }
    },
    now: Date.now, ids: randomUUID,
    log: entry => console.error('[plugin]', JSON.stringify(entry))
  })
  if (searchEndpoint) {
    // Existing configured-search policy is assembled here, never by the plugin or its catalog.
    local.toolRuntime.grants.push('tools.local.web.search@1')
  }
  await Promise.all(['command', 'image-generation', 'web', 'skills', 'documents', 'pdf', 'presentations', 'spreadsheets', ...(computer ? ['computer-use'] : [])].map(id => pluginPlatform.enable(id)))
  local.toolRuntime.grants.push('tools.local.web.open@1')
  local.toolRuntime.grants.push('tools.local.skills.read@1', 'tools.local.skills.install@1')
  const streamSessions = new StreamSessionService({
    ...(appApprovals ? { appApprovals } : {}),
    ...(computer ? { turnEnded: computer.endTurn } : {}),
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
    rawToolIO: { enabled: true },
    toolPresentation: toolId => pluginPlatform.catalogs().flatMap(({ catalog }) => catalog.tools).find(tool => tool.id === toolId)?.presentation
  })
  const server = createLocalRuntimeServer({
    ...(appApprovals ? { appApprovals } : {}),
    ...(approvalStore ? { appApprovalStore: approvalStore } : {}),
    adapters: local.adapters,
    computerControl,
    messages: repositories.messages,
    streamSnapshots: streamSessions,
    outputFiles: (taskId) => outputs.listByTask(taskId)
  })

  let httpServer: ServiceHttpServer | null = null

  if (serviceToken) {
    httpServer = await startServiceHttpServer({
      pluginPanels: { message: pluginPlatform.panelMessage },
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
      computerImages,
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
      await pluginPlatform?.dispose()
      await computer?.dispose()
      computerImages.clear()
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
