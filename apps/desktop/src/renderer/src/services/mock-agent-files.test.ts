import { describe, expect, it } from 'vitest'
import { AgentFileConflictError, AgentFilePathError } from '../models/agent-files'
import { MockAgentFilesService } from './mock-agent-files'

describe('MockAgentFilesService', () => {
  it('uses the same concise execution semantics as the real default prompt', async () => {
    const prompt = (await new MockAgentFilesService().getMainPrompt()).content

    expect(prompt).toContain('在当前可用能力范围内完成任务')
    expect(prompt).toContain('不得虚构工具调用、外部结果或完成状态')
    expect(prompt).toContain('不输出内部执行进度')
    expect(prompt).not.toContain('记录每一次模型与工具调用')
  })

  it('lists system skills from the read-only system directory and persists personal edits', async () => {
    const service = new MockAgentFilesService()
    const skills = await service.listSkills()

    expect(skills.map((skill) => skill.name)).toEqual([
      'browser-tools', 'computer-tools', 'Imagegen', 'report-writer', 'Skill Creator', 'data-inspector'
    ])
    const systemTree = await service.getSkillTree('skill-creator')
    expect(systemTree[0]?.path).toBe('.action-driver/skills/.system/skill-creator/SKILL.md')
    const systemFile = await service.readFile(systemTree[0]!.path)
    await expect(service.saveFile({
      path: systemFile.path,
      content: 'changed',
      expectedDigest: systemFile.digest
    })).rejects.toBeInstanceOf(AgentFilePathError)

    const file = await service.readFile('.action-driver/skills/data-inspector/SKILL.md')
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
