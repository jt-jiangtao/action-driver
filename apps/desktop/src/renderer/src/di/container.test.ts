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
import { MockModelConnectionsService } from '../services/mock-model-connections'
import { MockAgentRuntime } from '../services/mock-agent-runtime'
import { MockTaskCatalog } from '../services/mock-task-catalog'
import {
  MockBrowserSkillCapability,
  MockComputerUseSkillCapability,
  MockSkillGateway
} from '../services/mock-skill-capabilities'
import { createRendererContainer, resolveAppServices } from './container'

function createDesktopApi(): DesktopApi {
  return {
    getEnvironment: () => ({ platform: 'darwin', version: '0.1.0' }),
    agent: {
      submit: async () => ({ taskId: 'task-1' }),
      get: async () => null,
      interrupt: async () => undefined,
      continue: async () => undefined,
      provideInput: async () => undefined,
      controlSkill: async (invocationId, command) => ({
        id: `event-${command}`,
        invocationId,
        skillId: SKILL_IDS.browser,
        state: command === 'pause' ? 'paused' : command === 'resume' ? 'running' : 'taken-over',
        occurredAt: '2026-09-22T00:00:00.000Z'
      }),
      subscribe: async () => () => undefined
    },
    modelConnections: {
      list: async () => [],
      testConnection: async () => ({ ok: true }),
      discover: async () => [],
      refresh: async () => [],
      testModels: async () => [],
      testConnectionModels: async () => [],
      setModelEnabled: async () => undefined,
      add: async () => ({
        id: 'model-connection',
        name: '连接',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKeyHint: '••••test',
        expanded: true,
        models: []
      }),
      delete: async () => undefined
    },
    logs: {
      list: async () => ({ records: [], files: [], readable: true })
    },
    agentFiles: {
      getMainPrompt: async () => ({ path: '.action-driver/prompts/main.md', content: '', digest: 'a', modifiedAt: 'now' }),
      listSkills: async () => [],
      getSkillTree: async () => [],
      readFile: async (path) => ({ path, content: '', digest: 'a', modifiedAt: 'now' }),
      saveFile: async (input) => ({ ...input, digest: 'b', modifiedAt: 'now' }),
      createSkill: async (input) => ({ id: input.name, name: input.name, description: input.description, enabled: true, available: true, protected: false, modifiedAt: 'now' }),
      renameSkill: async (skillId, name) => ({ id: skillId, name, description: '', enabled: true, available: true, protected: false, modifiedAt: 'now' }),
      deleteSkill: async () => undefined,
      setSkillEnabled: async (skillId, enabled) => ({ id: skillId, name: skillId, description: '', enabled, available: true, protected: false, modifiedAt: 'now' })
    }
  }
}

describe('renderer composition root', () => {
  it('binds agent ports and the independently registered skill gateway without exposing the container', () => {
    const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))

    expect(services.agentCommandService).toBeInstanceOf(MockAgentRuntime)
    expect(services.agentSessionRepository).toBe(services.agentCommandService)
    expect(services.skillGateway).toBeInstanceOf(MockSkillGateway)
    expect(services.skillGateway).not.toBe(services.agentCommandService)
    expect(services.taskCatalog).toBeInstanceOf(MockTaskCatalog)
    expect(Object.keys(services).sort()).toEqual([
      'agentCommandService',
      'agentFilesService',
      'agentSessionRepository',
      'interactionLogService',
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
    const services = resolveAppServices(
      createRendererContainer({ mode: 'mock', skillGateway: replacement })
    )

    expect(services.skillGateway).toBe(replacement)
    expect(services.agentCommandService).not.toBe(replacement)
    expect(Object.keys(services)).toEqual([
      'agentCommandService',
      'agentSessionRepository',
      'skillGateway',
      'modelConnectionsService',
      'interactionLogService',
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
    const services = resolveAppServices(
      createRendererContainer({
        mode: 'mock',
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

  it('requires the whitelisted desktop API for local mode', () => {
    expect(() => createRendererContainer({ mode: 'local' })).toThrow(
      'Local renderer services require DesktopApi'
    )
  })

  it('binds local Agent, Session, and Skill ports to the Preload Runtime adapters', () => {
    const services = resolveAppServices(
      createRendererContainer({ mode: 'local', desktopApi: createDesktopApi() })
    )

    expect(services.agentCommandService).toBeInstanceOf(DesktopAgentAdapter)
    expect(services.agentSessionRepository).toBe(services.agentCommandService)
    expect(services.skillGateway).toBeInstanceOf(DesktopSkillGateway)
    expect(services.skillGateway).not.toBeInstanceOf(MockSkillGateway)
    expect(services.modelConnectionsService).toBeInstanceOf(DesktopModelConnectionsService)
  })

  it('binds the mock model connection service for fixture and visual runs', () => {
    const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))

    expect(services.modelConnectionsService).toBeInstanceOf(MockModelConnectionsService)
  })

  it('keeps explicit local port overrides replaceable without changing consumers', () => {
    const projection: TaskProjection = {
      id: 'replacement',
      title: 'Replacement',
      status: 'running',
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
    const services = resolveAppServices(
      createRendererContainer({
        mode: 'local',
        desktopApi: createDesktopApi(),
        agentCommandService: replacement,
        agentSessionRepository: replacement
      })
    )

    expect(services.agentCommandService).toBe(replacement)
    expect(services.agentSessionRepository).toBe(replacement)
  })
})
