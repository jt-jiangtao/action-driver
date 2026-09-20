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

export function createRendererContainer(overrides: RendererOverrides = {}): Container {
  const container = new Container()
  const browserCapability = overrides.browserCapability ?? new MockBrowserSkillCapability()
  const computerCapability = overrides.computerCapability ?? new MockComputerUseSkillCapability()
  const skillGateway =
    overrides.skillGateway ??
    new MockSkillGateway({
      [SKILL_IDS.browser]: browserCapability,
      [SKILL_IDS.computer]: computerCapability
    })
  const runtime = new MockAgentRuntime(skillGateway)
  container
    .bind<AgentCommandService>(SERVICE_TYPES.agentCommandService)
    .toConstantValue(overrides.agentCommandService ?? runtime)
  container
    .bind<AgentSessionRepository>(SERVICE_TYPES.agentSessionRepository)
    .toConstantValue(overrides.agentSessionRepository ?? runtime)
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
