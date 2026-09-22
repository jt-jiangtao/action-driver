import { describe, expect, it } from 'vitest'
import type { AgentFilesDesktopApi } from '../../../preload/desktop-api'
import { AgentFileConflictError, AgentFilePathError } from '../models/agent-files'
import { DesktopAgentFilesService } from './desktop-agent-files'

function apiStub(overrides: Partial<AgentFilesDesktopApi> = {}): AgentFilesDesktopApi {
  return {
    getMainPrompt: async () => ({ path: '.action-driver/prompts/main.md', content: '# Prompt', digest: 'a', modifiedAt: 'now' }),
    listSkills: async () => [],
    getSkillTree: async () => [],
    readFile: async (path) => ({ path, content: '# File', digest: 'b', modifiedAt: 'now' }),
    saveFile: async (input) => ({ ...input, digest: 'c', modifiedAt: 'later' }),
    createSkill: async (input) => ({ id: input.name, name: input.name, description: input.description, enabled: true, available: true, protected: false, modifiedAt: 'now' }),
    renameSkill: async (skillId, name) => ({ id: skillId, name, description: '', enabled: true, available: true, protected: false, modifiedAt: 'now' }),
    deleteSkill: async () => undefined,
    setSkillEnabled: async (skillId, enabled) => ({ id: skillId, name: skillId, description: '', enabled, available: true, protected: false, modifiedAt: 'now' }),
    ...overrides
  }
}

describe('DesktopAgentFilesService', () => {
  it('forwards successful file operations', async () => {
    const service = new DesktopAgentFilesService(apiStub())
    expect((await service.getMainPrompt()).content).toBe('# Prompt')
    expect((await service.readFile('.action-driver/skills/example/SKILL.md')).path).toContain('example')
  })

  it('maps conflict and path errors to renderer diagnostics', async () => {
    const conflict = new DesktopAgentFilesService(apiStub({ saveFile: async () => Promise.reject({ code: 'CONFLICT', message: 'changed' }) }))
    await expect(conflict.saveFile({ path: '.action-driver/prompts/main.md', content: '', expectedDigest: 'old' })).rejects.toBeInstanceOf(AgentFileConflictError)

    const rejectedPath = new DesktopAgentFilesService(apiStub({ readFile: async () => Promise.reject({ code: 'PATH_REJECTED', message: 'outside' }) }))
    await expect(rejectedPath.readFile('../outside')).rejects.toBeInstanceOf(AgentFilePathError)
  })
})
