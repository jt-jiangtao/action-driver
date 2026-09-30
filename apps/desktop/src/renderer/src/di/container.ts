import type {
  AgentCommandService,
  AgentSessionRepository,
  SkillCapability,
  SkillGateway,
  TaskProjection
} from '@action-driver/contracts'
import type { AgentFilesService } from '../models/agent-files'
import { SKILL_IDS } from '@action-driver/contracts'
import type { DesktopApi } from '../../../preload/desktop-api'
import { MockAgentSessionService } from '../services/agent-session/mock-agent-session-service'
import type { ModelConnectionsService } from '../models/model-connections'
import type { TaskCatalog } from '../models/task-catalog'
import { MockModelConnectionsService } from '../services/model-connections/mock-model-connections'
import { DesktopModelConnectionsService } from '../services/model-connections/desktop-model-connections'
import { MockTaskCatalog } from '../services/task-catalog/mock-task-catalog'
import { DesktopTaskCatalog } from '../services/task-catalog/desktop-task-catalog'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/skills/mock-skill-capabilities'
import { DesktopAgentAdapter, DesktopSkillGateway } from '../services/agent-session/desktop-agent-adapter'
import { MockAgentFilesService } from '../services/agent-files/mock-agent-files'
import { RuntimeAgentFilesService } from '../services/agent-files/runtime-agent-files'
import { RuntimeHttpClient } from '../services/transport/runtime-http-client'
import { RuntimeAgentHttpApi } from '../services/agent-session/runtime-agent-http-api'
import { RuntimeModelHttpApi } from '../services/model-connections/runtime-model-http-api'
import { RendererStreamClient } from '../services/agent-session/renderer-stream-client'
import {
  DesktopPluginContributionsService,
  MockPluginContributionsService,
  type PluginContributionsService
} from '../services/plugins/plugin-contributions'

export interface AppServices {
  agentCommandService: AgentCommandService
  agentSessionRepository: AgentSessionRepository
  skillGateway: SkillGateway
  modelConnectionsService: ModelConnectionsService
  agentFilesService: AgentFilesService
  taskCatalog: TaskCatalog
  pluginContributions: PluginContributionsService
  restoreTaskStream?: (task: TaskProjection) => Promise<void>
  imageAssets?: Pick<RuntimeHttpClient, 'uploadImage' | 'readImage'>
  inputFiles?: Pick<RuntimeHttpClient, 'uploadInputFile'>
  outputFiles?: Pick<RuntimeHttpClient, 'readOutputFile'>
}

interface RendererOverrides extends Partial<AppServices> {
  browserCapability?: SkillCapability<typeof SKILL_IDS.browser>
  computerCapability?: SkillCapability<typeof SKILL_IDS.computer>
}

export interface RendererContainerOptions extends RendererOverrides {
  mode: 'mock' | 'local'
  desktopApi?: DesktopApi
}

export function createRendererServices(options: RendererContainerOptions): AppServices {
  let agentCommandService: AgentCommandService
  let agentSessionRepository: AgentSessionRepository
  let skillGateway: SkillGateway
  let localAgentFilesService: AgentFilesService | null = null
  let localAgentApi: RuntimeAgentHttpApi | null = null
  let localModelApi: RuntimeModelHttpApi | null = null
  let restoreTaskStream: AppServices['restoreTaskStream']
  let imageAssets: AppServices['imageAssets']
  let inputFiles: AppServices['inputFiles']
  let outputFiles: AppServices['outputFiles']

  if (options.mode === 'local') {
    if (!options.desktopApi) throw new Error('Local renderer services require DesktopApi')

    const streamClient = new RendererStreamClient({
      getConnection: () => options.desktopApi!.runtimeConnection.get()
    })
    const http = new RuntimeHttpClient(() => options.desktopApi!.runtimeConnection.get())
    imageAssets = http
    inputFiles = http
    outputFiles = http
    localAgentFilesService = new RuntimeAgentFilesService(http)
    localAgentApi = new RuntimeAgentHttpApi(http)
    localModelApi = new RuntimeModelHttpApi(http)
    const agentFiles = localAgentFilesService
    const agentAdapter = new DesktopAgentAdapter(
      localAgentApi,
      streamClient,
      async () => (await agentFiles.getMainPrompt()).content,
      options.desktopApi!.browserSession
    )
    restoreTaskStream = (task) => agentAdapter.restoreTaskStream(task)
    agentCommandService = options.agentCommandService ?? agentAdapter
    agentSessionRepository = options.agentSessionRepository ?? agentAdapter
    skillGateway = options.skillGateway ?? new DesktopSkillGateway(localAgentApi)
  } else {
    const browserCapability = options.browserCapability ?? new MockBrowserSkillCapability()
    const computerCapability = options.computerCapability ?? new MockComputerUseSkillCapability()
    skillGateway =
      options.skillGateway ??
      new MockSkillGateway({
        [SKILL_IDS.browser]: browserCapability,
        [SKILL_IDS.computer]: computerCapability
      })
    const runtime = new MockAgentSessionService(skillGateway)
    agentCommandService = options.agentCommandService ?? runtime
    agentSessionRepository = options.agentSessionRepository ?? runtime
  }

  return {
    agentCommandService,
    agentSessionRepository,
    skillGateway,
    modelConnectionsService:
      options.modelConnectionsService ??
      (options.mode === 'local' && options.desktopApi
        ? new DesktopModelConnectionsService(localModelApi!)
        : new MockModelConnectionsService()),
    agentFilesService:
      options.agentFilesService ??
      (options.mode === 'local' && options.desktopApi
        ? localAgentFilesService!
        : new MockAgentFilesService()),
    taskCatalog:
      options.taskCatalog ??
      (options.mode === 'local' && options.desktopApi
        ? new DesktopTaskCatalog(localAgentApi!)
        : new MockTaskCatalog()),
    pluginContributions:
      options.pluginContributions ??
      (options.mode === 'local' && options.desktopApi
        ? new DesktopPluginContributionsService(options.desktopApi)
        : new MockPluginContributionsService()),
    ...(restoreTaskStream ? { restoreTaskStream } : {}),
    ...(imageAssets ? { imageAssets } : {}),
    ...(inputFiles ? { inputFiles } : {}),
    ...(outputFiles ? { outputFiles } : {})
  }
}
