import type {
  AgentCommandService,
  AgentSessionRepository,
  SkillCapability,
  SkillGateway
} from '@actiondriver/contracts'
import { SERVICE_TYPES, SKILL_IDS } from '@actiondriver/contracts'
import { Container } from 'inversify'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import type { ModelConnectionsService } from '../models/model-connections'
import type { TaskCatalog } from '../models/task-catalog'
import { MockModelConnectionsService } from '../services/mock-model-connections'
import { MockTaskCatalog } from '../services/mock-task-catalog'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'

export interface AppServices {
  agentCommandService: AgentCommandService
  agentSessionRepository: AgentSessionRepository
  skillGateway: SkillGateway
  modelConnectionsService: ModelConnectionsService
  taskCatalog: TaskCatalog
}

const MODEL_CONNECTIONS_SERVICE = Symbol('MODEL_CONNECTIONS_SERVICE')
const TASK_CATALOG = Symbol('TASK_CATALOG')

interface RendererOverrides extends Partial<AppServices> {
  browserCapability?: SkillCapability<typeof SKILL_IDS.browser>
  computerCapability?: SkillCapability<typeof SKILL_IDS.computer>
}

export interface RendererContainerOptions extends RendererOverrides {
  mode: 'mock' | 'local'
}

export function createRendererContainer(options: RendererContainerOptions): Container {
  if (options.mode === 'local') throw new Error('Local renderer services are not configured')

  const container = new Container()
  const browserCapability = options.browserCapability ?? new MockBrowserSkillCapability()
  const computerCapability = options.computerCapability ?? new MockComputerUseSkillCapability()
  const skillGateway =
    options.skillGateway ??
    new MockSkillGateway({
      [SKILL_IDS.browser]: browserCapability,
      [SKILL_IDS.computer]: computerCapability
    })
  const runtime = new MockAgentRuntime(skillGateway)
  container
    .bind<AgentCommandService>(SERVICE_TYPES.agentCommandService)
    .toConstantValue(options.agentCommandService ?? runtime)
  container
    .bind<AgentSessionRepository>(SERVICE_TYPES.agentSessionRepository)
    .toConstantValue(options.agentSessionRepository ?? runtime)
  container.bind<SkillGateway>(SERVICE_TYPES.skillGateway).toConstantValue(skillGateway)
  container
    .bind<ModelConnectionsService>(MODEL_CONNECTIONS_SERVICE)
    .toConstantValue(options.modelConnectionsService ?? new MockModelConnectionsService())
  container
    .bind<TaskCatalog>(TASK_CATALOG)
    .toConstantValue(options.taskCatalog ?? new MockTaskCatalog())
  return container
}

export function resolveAppServices(container: Container): AppServices {
  return {
    agentCommandService: container.get(SERVICE_TYPES.agentCommandService),
    agentSessionRepository: container.get(SERVICE_TYPES.agentSessionRepository),
    skillGateway: container.get(SERVICE_TYPES.skillGateway),
    modelConnectionsService: container.get(MODEL_CONNECTIONS_SERVICE),
    taskCatalog: container.get(TASK_CATALOG)
  }
}
