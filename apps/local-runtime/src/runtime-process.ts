import { createRuntimePluginAssembly } from './runtime-plugin-assembly'
import { createRuntimeStorage } from './runtime-storage'
import { createRuntimeExecutionEnvironment } from './runtime-execution'
import { createLocalRuntimeServer } from './local-runtime-server'
import { createLocalRuntimeAdapters } from './local-adapters'
import type { RuntimeReadyDescriptor } from './runtime-host'
import { ConnectionModelGateway } from '@action-driver/agent-runtime/model-gateway'
import { PhoenixModelObservability } from './phoenix-model-observability'
import { startServiceHttpServer, type ServiceHttpServer } from './service/http-service'
import { StreamSessionService } from '@action-driver/agent-runtime/stream-session-service'
import { SERVICE_STREAM_PATH, SERVICE_STREAM_PROTOCOL } from './service/websocket-service'
import { randomUUID } from 'node:crypto'
import { SessionExecutionContextResolver } from './execution/session-execution-context'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginInstructionHost } from './plugins/instruction-host'
import { AgentFileStore } from './agent-files/agent-file-store'
import { SkillInstaller } from './agent-files/skill-installer'
import type { RuntimeSkillRegistry } from '@action-driver/agent-runtime/skill-registry'
import { createResourceHttpPort } from './resources/runtime-resources'
import { PlacementRouter, parseRemoteHostDeclarations } from './placement/router'
import { createComputerUseEntry } from './computer-use/entry'
import { ComputerUseControlGate } from './computer-use/control-gate'
import { LoadedSkills } from './computer-use/skill-gate'
import type { AppApprovalBroker } from './computer-use/app-approval-broker'
import { AppApprovalStore } from './computer-use/app-approval-store'

export type LocalRuntimeOptions = {
  dataRoot: string
  workspaceRoot: string
  environment?: NodeJS.ProcessEnv
}

export type LocalRuntime = {
  ready: RuntimeReadyDescriptor
  close(): Promise<void>
}

export async function createLocalRuntime(options: LocalRuntimeOptions): Promise<LocalRuntime> {
  const { dataRoot } = options
  const environment = options.environment ?? process.env
  const workspaceRoot = options.workspaceRoot.trim()
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
  const execution = await createRuntimeExecutionEnvironment({ runtimeEntry, workspaceRoot, environment })
  const { runtimeDist, agentHome } = execution
  const serviceToken = environment.ACTION_DRIVER_SERVICE_TOKEN?.trim()
  const storage = await createRuntimeStorage({ dataRoot, workspaceRoot, environment })
  let startupPlugin: Awaited<ReturnType<typeof createRuntimePluginAssembly>> | null = null
  let startupComputer: Awaited<ReturnType<typeof createComputerUseEntry>> | null = null
  let startupHttpServer: ServiceHttpServer | null = null
  try {
  const {
    database, repositories, assets, computerImages, workspaces, inputFiles, outputs,
    resourceRegistry, checkpointer, logging, interactions, service
  } = storage
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
    const invokeBrowser = async (taskId: string, command: Record<string, unknown>,
      signal?: AbortSignal) => {
      const provider = local.adapters.skillRegistry.resolve('browser-use', 1)
      const result = await provider.execute({ invocationId: randomUUID(),
        input: { action: 'rpc', taskId, command } }, signal)
      return result.input
    }
    approvalStore = new AppApprovalStore(database)
    // The model reaches the desktop only through the Codex js / js_reset entry; each app is
    // approved inside the call, and the turn's approvals and app leases end with the turn.
    // A broken Computer Use install (for example missing vendored docs) disables only Computer
    // Use; the rest of the runtime must still start.
    computer = await createComputerUseEntry({
      runtimeDist,
      invoke: invokeComputer,
      invokeBrowser,
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
      startupComputer = computer
      appApprovals = computer.approvals
      for (const tool of computer.tools) {
        local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
      }
    }
  }
  const pluginPlatform = await createRuntimePluginAssembly({
    dataRoot, environment, execution, storage, local, executionContexts,
    pluginInstructions, agentFiles, skillInstaller, loadedSkills, computer
  })
  startupPlugin = pluginPlatform
  // Capability placement: this process registers itself as the local host and adopts any declared
  // remote hosts. Tools without a placement declaration keep running right here, unchanged.
  const placement = new PlacementRouter()
  const cuaBindings = computer
    ? {
        'tools/local/cua/js': { skillId: 'computer-use', contractVersion: 1 },
        'tools/local/cua/reset': { skillId: 'computer-use', contractVersion: 1 }
      }
    : {}
  placement.registerLocalHost({
    hostId: 'runtime',
    instanceId: randomUUID(),
    kind: 'local-workspace',
    target: 'local',
    devices: ['filesystem', 'network', ...(process.platform === 'darwin' ? ['display', 'input'] : [])],
    workspace: 'session-workspace',
    tools: local.toolRuntime.registry.list().map(tool => tool.id),
    plugins: pluginPlatform.catalogs().map(({ manifest }) => ({ id: manifest.id, version: manifest.version })),
    bindings: cuaBindings,
    resolve: (skillId, contractVersion) => local.adapters.skillRegistry.resolve(skillId, contractVersion)
  })
  for (const declaration of parseRemoteHostDeclarations(environment)) {
    await placement.connectRemoteHost(declaration).catch((error: unknown) => {
      // An unreachable host withdraws its new calls; it must not stop the runtime from starting.
      console.error('[runtime] placement host is unavailable', declaration.baseUrl, error)
    })
  }
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
      pluginInterface: { message: pluginPlatform.panelMessage, contributions: pluginPlatform.uiContributions, openView: pluginPlatform.openView, executeCommand: pluginPlatform.executeCommand },
      service,
      assets,
      inputFiles,
      outputs,
      agentFiles,
      skillInstaller,
      taskControl: server,
      token: serviceToken,
      runtimeVersion: environment.ACTION_DRIVER_RUNTIME_VERSION ?? '0.1.0',
      logger: logging.logger,
      interactions,
      streamSessions,
      skillRegistry: local.adapters.skillRegistry as RuntimeSkillRegistry,
      computerImages,
      resourceRoutes: createResourceHttpPort(resourceRegistry),
      placementRoutes: placement.routes(),
      ...(environment.ACTION_DRIVER_RENDERER_ORIGIN?.trim()
        ? { rendererOrigin: environment.ACTION_DRIVER_RENDERER_ORIGIN.trim() }
        : {})
    })
    startupHttpServer = httpServer
  }

  let closing: Promise<void> | null = null
  const close = () => {
    closing ??= (async () => {
      await server.close()
      await pluginPlatform?.dispose()
      await computer?.dispose()
      computerImages.clear()
      await httpServer?.close()
      await storage.close()
    })()
    return closing
  }

  console.error(
    '[runtime] ready',
    httpServer ? `${httpServer.url}${SERVICE_STREAM_PATH}` : 'no-http-service',
    Date.now()
  )
  return {
    ready: { service: httpServer
      ? {
          baseUrl: httpServer.url,
          streamPath: SERVICE_STREAM_PATH,
          streamProtocol: SERVICE_STREAM_PROTOCOL
        }
      : null },
    close
  }
  } catch (error) {
    for (const release of [
      () => startupHttpServer?.close(),
      () => startupPlugin?.dispose(),
      () => startupComputer?.dispose(),
      () => { storage.computerImages.clear() },
      () => storage.close()
    ]) {
      try { await release() } catch { /* preserve the startup failure */ }
    }
    throw error
  }
}
