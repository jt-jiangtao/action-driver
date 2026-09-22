import { describe, expect, it } from 'vitest'
import { AgentFileConflictError, AgentFilePathError } from '../models/agent-files'
import { MockAgentFilesService } from './mock-agent-files'

describe('MockAgentFilesService', () => {
  it('lists mock skills and persists edits in memory', async () => {
    const service = new MockAgentFilesService()
    const skills = await service.listSkills()

    expect(skills.map((skill) => skill.name)).toEqual(['browser-tools', 'report-writer', 'data-inspector'])
    const file = await service.readFile('.action-driver/skills/browser-tools/SKILL.md')
    const saved = await service.saveFile({
      path: file.path,
      content: `${file.content}\n\n## Notes\nUpdated`,
      expectedDigest: file.digest
    })

    expect((await service.readFile(file.path)).content).toContain('Updated')
    expect(saved.digest).not.toBe(file.digest)
  })

  it('reports conflicts and rejects paths outside the managed directory', async () => {
    const service = new MockAgentFilesService()
    const file = await service.getMainPrompt()

    await expect(
      service.saveFile({ path: file.path, content: 'changed', expectedDigest: 'stale' })
    ).rejects.toBeInstanceOf(AgentFileConflictError)
    await expect(service.readFile('../secrets.txt')).rejects.toBeInstanceOf(AgentFilePathError)
  })

  it('creates, renames, toggles, and deletes an editable skill', async () => {
    const service = new MockAgentFilesService()
    const created = await service.createSkill({ name: 'release-helper', description: '整理发布记录' })

    expect(await service.getSkillTree(created.id)).toHaveLength(2)
    expect((await service.renameSkill(created.id, 'release-notes')).name).toBe('release-notes')
    expect((await service.setSkillEnabled(created.id, false)).enabled).toBe(false)
    await service.deleteSkill(created.id)
    expect((await service.listSkills()).some((skill) => skill.id === created.id)).toBe(false)
  })
})
