import type {
  AgentCommandService,
  AgentSessionRepository,
  SkillCapability,
  SkillGateway
} from '@actiondriver/contracts'
import type { InteractionLogService } from '../models/interaction-logs'
import type { AgentFilesService } from '../models/agent-files'
import {
  DesktopInteractionLogService,
  MockInteractionLogService
} from '../services/desktop-interaction-logs'
import { SERVICE_TYPES, SKILL_IDS } from '@actiondriver/contracts'
import { Container } from 'inversify'
import type { DesktopApi } from '../../../preload/desktop-api'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import type { ModelConnectionsService } from '../models/model-connections'
import type { TaskCatalog } from '../models/task-catalog'
import { MockModelConnectionsService } from '../services/mock-model-connections'
import { DesktopModelConnectionsService } from '../services/desktop-model-connections'
import { MockTaskCatalog } from '../services/mock-task-catalog'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'
import { DesktopAgentAdapter, DesktopSkillGateway } from '../services/desktop-agent-adapter'
import { MockAgentFilesService } from '../services/mock-agent-files'
import { DesktopAgentFilesService } from '../services/desktop-agent-files'

export interface AppServices {
  agentCommandService: AgentCommandService
  agentSessionRepository: AgentSessionRepository
  skillGateway: SkillGateway
  modelConnectionsService: ModelConnectionsService
  interactionLogService: InteractionLogService
  agentFilesService: AgentFilesService
  taskCatalog: TaskCatalog
}

const MODEL_CONNECTIONS_SERVICE = Symbol('MODEL_CONNECTIONS_SERVICE')
const INTERACTION_LOG_SERVICE = Symbol('INTERACTION_LOG_SERVICE')
const AGENT_FILES_SERVICE = Symbol('AGENT_FILES_SERVICE')
const TASK_CATALOG = Symbol('TASK_CATALOG')

interface RendererOverrides extends Partial<AppServices> {
  browserCapability?: SkillCapability<typeof SKILL_IDS.browser>
  computerCapability?: SkillCapability<typeof SKILL_IDS.computer>
}

export interface RendererContainerOptions extends RendererOverrides {
  mode: 'mock' | 'local'
  desktopApi?: DesktopApi
}

export function createRendererContainer(options: RendererContainerOptions): Container {
  const container = new Container()
  let agentCommandService: AgentCommandService
  let agentSessionRepository: AgentSessionRepository
  let skillGateway: SkillGateway

  if (options.mode === 'local') {
    if (!options.desktopApi) throw new Error('Local renderer services require DesktopApi')

    const agentAdapter = new DesktopAgentAdapter(options.desktopApi.agent)
    agentCommandService = options.agentCommandService ?? agentAdapter
    agentSessionRepository = options.agentSessionRepository ?? agentAdapter
    skillGateway = options.skillGateway ?? new DesktopSkillGateway(options.desktopApi.agent)
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

  container
    .bind<AgentCommandService>(SERVICE_TYPES.agentCommandService)
    .toConstantValue(agentCommandService)
  container
    .bind<AgentSessionRepository>(SERVICE_TYPES.agentSessionRepository)
    .toConstantValue(agentSessionRepository)
  container.bind<SkillGateway>(SERVICE_TYPES.skillGateway).toConstantValue(skillGateway)
  container
    .bind<ModelConnectionsService>(MODEL_CONNECTIONS_SERVICE)
    .toConstantValue(
      options.modelConnectionsService ??
        (options.mode === 'local' && options.desktopApi
          ? new DesktopModelConnectionsService(options.desktopApi.modelConnections)
          : new MockModelConnectionsService())
    )
  container
    .bind<TaskCatalog>(TASK_CATALOG)
    .toConstantValue(options.taskCatalog ?? new MockTaskCatalog())
  container
    .bind<InteractionLogService>(INTERACTION_LOG_SERVICE)
    .toConstantValue(
      options.interactionLogService ??
        (options.mode === 'local' && options.desktopApi
          ? new DesktopInteractionLogService(options.desktopApi.logs)
          : new MockInteractionLogService())
    )
  container
    .bind<AgentFilesService>(AGENT_FILES_SERVICE)
    .toConstantValue(
      options.agentFilesService ??
        (options.mode === 'local' && options.desktopApi
          ? new DesktopAgentFilesService(options.desktopApi.agentFiles)
          : new MockAgentFilesService())
    )
  return container
}

export function resolveAppServices(container: Container): AppServices {
  return {
    agentCommandService: container.get(SERVICE_TYPES.agentCommandService),
    agentSessionRepository: container.get(SERVICE_TYPES.agentSessionRepository),
    skillGateway: container.get(SERVICE_TYPES.skillGateway),
    modelConnectionsService: container.get(MODEL_CONNECTIONS_SERVICE),
    interactionLogService: container.get(INTERACTION_LOG_SERVICE),
    agentFilesService: container.get(AGENT_FILES_SERVICE),
    taskCatalog: container.get(TASK_CATALOG)
  }
}
