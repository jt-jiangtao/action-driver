import type {
  AgentCommandService,
  AgentSessionRepository,
  SkillCapability,
  SkillGateway,
  TaskProjection
} from '@actiondriver/contracts'
import type { AgentFilesService } from '../models/agent-files'
import { SKILL_IDS } from '@actiondriver/contracts'
import type { DesktopApi } from '../../../preload/desktop-api'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import type { ModelConnectionsService } from '../models/model-connections'
import type { TaskCatalog } from '../models/task-catalog'
import { MockModelConnectionsService } from '../services/mock-model-connections'
import { DesktopModelConnectionsService } from '../services/desktop-model-connections'
import { MockTaskCatalog } from '../services/mock-task-catalog'
import { DesktopTaskCatalog } from '../services/desktop-task-catalog'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'
import { DesktopAgentAdapter, DesktopSkillGateway } from '../services/desktop-agent-adapter'
import { MockAgentFilesService } from '../services/mock-agent-files'
import { RuntimeAgentFilesService } from '../services/runtime-agent-files'
import { RuntimeHttpClient } from '../services/runtime-http-client'
import { RuntimeAgentHttpApi } from '../services/runtime-agent-http-api'
import { RuntimeModelHttpApi } from '../services/runtime-model-http-api'
import { RendererStreamClient } from '../services/renderer-stream-client'

export interface AppServices {
  agentCommandService: AgentCommandService
  agentSessionRepository: AgentSessionRepository
  skillGateway: SkillGateway
  modelConnectionsService: ModelConnectionsService
  agentFilesService: AgentFilesService
  taskCatalog: TaskCatalog
  restoreTaskStream?: (task: TaskProjection) => Promise<void>
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

  if (options.mode === 'local') {
    if (!options.desktopApi) throw new Error('Local renderer services require DesktopApi')

    const streamClient = new RendererStreamClient({
      getConnection: () => options.desktopApi!.runtimeConnection.get()
    })
    const http = new RuntimeHttpClient(() => options.desktopApi!.runtimeConnection.get())
    localAgentFilesService = new RuntimeAgentFilesService(http)
    localAgentApi = new RuntimeAgentHttpApi(http)
    localModelApi = new RuntimeModelHttpApi(http)
    const agentFiles = localAgentFilesService
    const agentAdapter = new DesktopAgentAdapter(
      localAgentApi,
      streamClient,
      async () => (await agentFiles.getMainPrompt()).content
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
    const runtime = new MockAgentRuntime(skillGateway)
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
    ...(restoreTaskStream ? { restoreTaskStream } : {})
  }
}
