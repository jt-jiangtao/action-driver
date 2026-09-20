import { describe, expect, it } from 'vitest'
import { SKILL_IDS, type SkillCapability } from '@actiondriver/contracts'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'
import { createRendererContainer, resolveAppServices } from './container'

describe('renderer composition root', () => {
  it('binds agent ports and the independently registered skill gateway without exposing the container', () => {
    const services = resolveAppServices(createRendererContainer())

    expect(services.agentCommandService).toBeInstanceOf(MockAgentRuntime)
    expect(services.agentSessionRepository).toBe(services.agentCommandService)
    expect(services.skillGateway).toBeInstanceOf(MockSkillGateway)
    expect(services.skillGateway).not.toBe(services.agentCommandService)
    expect(Object.keys(services).sort()).toEqual([
      'agentCommandService',
      'agentSessionRepository',
      'skillGateway'
    ])
  })

  it('replaces an adapter binding without changing React consumers', () => {
    const replacement = new MockSkillGateway({
      [SKILL_IDS.browser]: new MockBrowserSkillCapability(),
      [SKILL_IDS.computer]: new MockComputerUseSkillCapability()
    })
    const services = resolveAppServices(createRendererContainer({ skillGateway: replacement }))

    expect(services.skillGateway).toBe(replacement)
    expect(services.agentCommandService).not.toBe(replacement)
    expect(Object.keys(services)).toEqual([
      'agentCommandService',
      'agentSessionRepository',
      'skillGateway'
    ])
  })

  it('registers Browser and Computer Use as independently replaceable capabilities', async () => {
    const browserCapability: SkillCapability<typeof SKILL_IDS.browser> = {
      skillId: SKILL_IDS.browser,
      invoke: async (invocation) => ({
        id: 'browser-running',
        invocationId: invocation.id,
        skillId: SKILL_IDS.browser,
        state: 'running',
        occurredAt: '2026-09-20T12:00:00.000Z'
      }),
      transition: async () => {
        throw new Error('not needed')
      }
    }
    const services = resolveAppServices(
      createRendererContainer({
        browserCapability,
        computerCapability: new MockComputerUseSkillCapability()
      })
    )

    await services.agentCommandService.submitGoal('使用浏览器')

    expect(services.agentCommandService).toBeInstanceOf(MockAgentRuntime)
    expect(services.skillGateway.getCapability(SKILL_IDS.browser)).toBe(browserCapability)
    expect(services.skillGateway.getCapability(SKILL_IDS.computer)).toBeInstanceOf(
      MockComputerUseSkillCapability
    )
  })
})
