import type {
  AgentCommandService,
  AgentSessionRepository,
  SkillCapability,
  SkillGateway
} from '@actiondriver/contracts'
import { SERVICE_TYPES, SKILL_IDS } from '@actiondriver/contracts'
import { Container } from 'inversify'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'

export interface AppServices {
  agentCommandService: AgentCommandService
  agentSessionRepository: AgentSessionRepository
  skillGateway: SkillGateway
}

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
  return container
}

export function resolveAppServices(container: Container): AppServices {
  return {
    agentCommandService: container.get(SERVICE_TYPES.agentCommandService),
    agentSessionRepository: container.get(SERVICE_TYPES.agentSessionRepository),
    skillGateway: container.get(SERVICE_TYPES.skillGateway)
  }
}
