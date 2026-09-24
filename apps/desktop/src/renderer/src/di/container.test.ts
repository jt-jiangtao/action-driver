import { describe, expect, it } from 'vitest'
import {
  SKILL_IDS,
  type AgentCommandService,
  type AgentSessionRepository,
  type SkillCapability,
  type TaskProjection
} from '@actiondriver/contracts'
import type { DesktopApi } from '../../../preload/desktop-api'
import { DesktopAgentAdapter, DesktopSkillGateway } from '../services/desktop-agent-adapter'
import { DesktopModelConnectionsService } from '../services/desktop-model-connections'
import { RuntimeAgentFilesService } from '../services/runtime-agent-files'
import { MockModelConnectionsService } from '../services/mock-model-connections'
import { MockAgentFilesService } from '../services/mock-agent-files'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import { MockTaskCatalog } from '../services/mock-task-catalog'
import { DesktopTaskCatalog } from '../services/desktop-task-catalog'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'
import { createRendererServices } from './container'

function createDesktopApi(): DesktopApi {
  return {
    getEnvironment: () => ({ platform: 'darwin', version: '0.1.0' }),
    runtimeConnection: {
      get: async () => ({
        wsUrl: 'ws://127.0.0.1:4321/stream',
        protocol: 'actiondriver.stream.v2',
        accessToken: 'launch-token'
      })
    },
    skillFolders: {
      choose: async () => null,
      browse: async () => undefined,
      reveal: async () => undefined
    },
    externalLinks: { open: async () => undefined }
  }
}

describe('renderer composition root', () => {
  it('provides explicit typed services directly', () => {
    const services = createRendererServices({ mode: 'mock' })
    expect(services.agentCommandService).toBeDefined()
    expect(services.taskCatalog).toBeDefined()
  })

  it('binds agent ports and the independently registered skill gateway without exposing the container', () => {
    const services = createRendererServices({ mode: 'mock' })

    expect(services.agentCommandService).toBeInstanceOf(MockAgentRuntime)
    expect(services.agentSessionRepository).toBe(services.agentCommandService)
    expect(services.skillGateway).toBeInstanceOf(MockSkillGateway)
    expect(services.agentFilesService).toBeInstanceOf(MockAgentFilesService)
    expect(services.skillGateway).not.toBe(services.agentCommandService)
    expect(services.taskCatalog).toBeInstanceOf(MockTaskCatalog)
    expect(Object.keys(services).sort()).toEqual([
      'agentCommandService',
      'agentFilesService',
      'agentSessionRepository',
      'modelConnectionsService',
      'skillGateway',
      'taskCatalog'
    ])
  })

  it('replaces an adapter binding without changing React consumers', () => {
    const replacement = new MockSkillGateway({
      [SKILL_IDS.browser]: new MockBrowserSkillCapability(),
      [SKILL_IDS.computer]: new MockComputerUseSkillCapability()
    })
    const services = createRendererServices({ mode: 'mock', skillGateway: replacement })

    expect(services.skillGateway).toBe(replacement)
    expect(services.agentCommandService).not.toBe(replacement)
    expect(Object.keys(services)).toEqual([
      'agentCommandService',
      'agentSessionRepository',
      'skillGateway',
      'modelConnectionsService',
      'agentFilesService',
      'taskCatalog'
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
    const services = createRendererServices({
        mode: 'mock',
        browserCapability,
        computerCapability: new MockComputerUseSkillCapability()
      })

    await services.agentCommandService.submitGoal({
      goal: '使用浏览器',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })

    expect(services.agentCommandService).toBeInstanceOf(MockAgentRuntime)
    expect(services.skillGateway.getCapability(SKILL_IDS.browser)).toBe(browserCapability)
    expect(services.skillGateway.getCapability(SKILL_IDS.computer)).toBeInstanceOf(
      MockComputerUseSkillCapability
    )
  })

  it('requires the whitelisted desktop API for local mode', () => {
    expect(() => createRendererServices({ mode: 'local' })).toThrow(
      'Local renderer services require DesktopApi'
    )
  })

  it('binds local Agent, Session, and Skill ports to the Preload Runtime adapters', () => {
    const services = createRendererServices({ mode: 'local', desktopApi: createDesktopApi() })

    expect(services.agentCommandService).toBeInstanceOf(DesktopAgentAdapter)
    expect(services.agentSessionRepository).toBe(services.agentCommandService)
    expect(services.skillGateway).toBeInstanceOf(DesktopSkillGateway)
    expect(services.skillGateway).not.toBeInstanceOf(MockSkillGateway)
    expect(services.modelConnectionsService).toBeInstanceOf(DesktopModelConnectionsService)
    expect(services.agentFilesService).toBeInstanceOf(RuntimeAgentFilesService)
    expect(services.taskCatalog).toBeInstanceOf(DesktopTaskCatalog)
  })

  it('binds the mock model connection service for fixture and visual runs', () => {
    const services = createRendererServices({ mode: 'mock' })

    expect(services.modelConnectionsService).toBeInstanceOf(MockModelConnectionsService)
  })

  it('keeps explicit local port overrides replaceable without changing consumers', () => {
    const projection: TaskProjection = {
      id: 'replacement',
      sessionId: 'replacement-session',
      title: 'Replacement',
      status: 'running',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      messages: [],
      steps: [],
      browser: null
    }
    const replacement: AgentCommandService & AgentSessionRepository = {
      submitGoal: async () => projection,
      interrupt: async () => undefined,
      continueTask: async () => undefined,
      getTask: () => projection,
      subscribe: () => () => undefined
    }
    const services = createRendererServices({
        mode: 'local',
        desktopApi: createDesktopApi(),
        agentCommandService: replacement,
        agentSessionRepository: replacement
      })

    expect(services.agentCommandService).toBe(replacement)
    expect(services.agentSessionRepository).toBe(replacement)
  })
})
