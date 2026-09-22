import {
  AgentFileConflictError,
  AgentFilePathError,
  type AgentFileNode,
  type AgentFilesService,
  type AgentSkillSummary,
  type AgentTextFile,
  type CreateAgentSkillInput,
  type SaveAgentFileInput
} from '../models/agent-files'

const MAIN_PROMPT_PATH = '.action-driver/prompts/main.md'
const SKILLS_ROOT = '.action-driver/skills/'
const DEFAULT_MAIN_PROMPT =
  '# ActionDriver 主提示词\n\n你是 ActionDriver 中的执行助手。\n\n## 原则\n\n- 在执行前确认用户目标。\n- 记录每一次模型与工具调用。\n- 当结果不确定时，说明假设与边界。'

interface StoredFile {
  content: string
  modifiedAt: string
}

const now = () => new Date().toISOString()

function digest(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `mock-${(hash >>> 0).toString(16)}`
}

function assertManagedPath(path: string): void {
  const isManaged = path === MAIN_PROMPT_PATH || path.startsWith(SKILLS_ROOT)
  if (!isManaged || path.includes('..') || path.startsWith('/') || path.includes('\\')) {
    throw new AgentFilePathError()
  }
}

const builtInSkills: AgentSkillSummary[] = [
  {
    id: 'browser-tools',
    name: 'browser-tools',
    description: '通过浏览器搜索、读取并整理网页信息。',
    enabled: true,
    available: true,
    executorId: 'browser-use',
    unavailableReason: null,
    protected: true,
    modifiedAt: '2026-09-20T09:30:00.000Z'
  },
  {
    id: 'report-writer',
    name: 'report-writer',
    description: '将任务结果组织为结构化 Markdown 报告。',
    enabled: true,
    available: true,
    executorId: 'report-use',
    unavailableReason: null,
    protected: false,
    modifiedAt: '2026-09-19T14:18:00.000Z'
  },
  {
    id: 'data-inspector',
    name: 'data-inspector',
    description: '检查本地数据文件并输出质量摘要。',
    enabled: false,
    available: false,
    executorId: null,
    unavailableReason: 'missing-executor',
    protected: false,
    modifiedAt: '2026-09-17T08:42:00.000Z'
  }
]

export class MockAgentFilesService implements AgentFilesService {
  private skills = builtInSkills.map((skill) => ({ ...skill }))

  private files = new Map<string, StoredFile>([
    [
      MAIN_PROMPT_PATH,
      {
        content: DEFAULT_MAIN_PROMPT,
        modifiedAt: '2026-09-21T10:24:00.000Z'
      }
    ],
    ...builtInSkills.flatMap(
      (skill): Array<[string, StoredFile]> => [
        [
          `${SKILLS_ROOT}${skill.id}/SKILL.md`,
          {
            content: `# ${skill.name}\n\n${skill.description}\n\n## Usage\n\n当任务匹配该能力时使用。`,
            modifiedAt: skill.modifiedAt
          }
        ],
        [
          `${SKILLS_ROOT}${skill.id}/references/README.md`,
          {
            content: `# ${skill.name} references\n\n在这里放置该 Skill 使用的参考资料。`,
            modifiedAt: skill.modifiedAt
          }
        ]
      ]
    )
  ])

  async getMainPrompt(): Promise<AgentTextFile> {
    return this.readFile(MAIN_PROMPT_PATH)
  }

  async resetMainPrompt(expectedDigest: string): Promise<AgentTextFile> {
    return this.saveFile({
      path: MAIN_PROMPT_PATH,
      content: DEFAULT_MAIN_PROMPT,
      expectedDigest
    })
  }

  async listSkills(): Promise<AgentSkillSummary[]> {
    return this.skills.map((skill) => ({ ...skill }))
  }

  async getSkillTree(skillId: string): Promise<AgentFileNode[]> {
    this.getSkill(skillId)
    return [
      { name: 'SKILL.md', path: `${SKILLS_ROOT}${skillId}/SKILL.md`, kind: 'file' },
      {
        name: 'references',
        path: `${SKILLS_ROOT}${skillId}/references`,
        kind: 'directory',
        children: [
          {
            name: 'README.md',
            path: `${SKILLS_ROOT}${skillId}/references/README.md`,
            kind: 'file'
          }
        ]
      }
    ]
  }

  async readFile(path: string): Promise<AgentTextFile> {
    assertManagedPath(path)
    const stored = this.files.get(path)
    if (!stored) throw new Error(`找不到文件：${path}`)
    return {
      path,
      content: stored.content,
      digest: digest(stored.content),
      modifiedAt: stored.modifiedAt
    }
  }

  async saveFile(input: SaveAgentFileInput): Promise<AgentTextFile> {
    const current = await this.readFile(input.path)
    if (current.digest !== input.expectedDigest) throw new AgentFileConflictError()
    this.files.set(input.path, { content: input.content, modifiedAt: now() })
    return this.readFile(input.path)
  }

  async createSkill(input: CreateAgentSkillInput): Promise<AgentSkillSummary> {
    const id = input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
    if (!id || this.skills.some((skill) => skill.id === id)) {
      throw new Error('名称不可用，请使用唯一的小写英文名称。')
    }
    const skill: AgentSkillSummary = {
      id,
      name: id,
      description: input.description.trim() || '暂无描述',
      enabled: true,
      available: true,
      executorId: 'mock-custom-use',
      unavailableReason: null,
      protected: false,
      modifiedAt: now()
    }
    this.skills.push(skill)
    this.files.set(`${SKILLS_ROOT}${id}/SKILL.md`, {
      content: `# ${id}\n\n${skill.description}\n`,
      modifiedAt: skill.modifiedAt
    })
    this.files.set(`${SKILLS_ROOT}${id}/references/README.md`, {
      content: '# References\n',
      modifiedAt: skill.modifiedAt
    })
    return { ...skill }
  }

  async renameSkill(skillId: string, name: string): Promise<AgentSkillSummary> {
    const skill = this.getSkill(skillId)
    if (skill.protected) throw new Error('内置 Skill 不能重命名。')
    skill.name = name.trim()
    skill.modifiedAt = now()
    return { ...skill }
  }

  async deleteSkill(skillId: string): Promise<void> {
    const skill = this.getSkill(skillId)
    if (skill.protected) throw new Error('内置 Skill 不能删除。')
    this.skills = this.skills.filter((candidate) => candidate.id !== skillId)
    for (const path of this.files.keys()) {
      if (path.startsWith(`${SKILLS_ROOT}${skillId}/`)) this.files.delete(path)
    }
  }

  async setSkillEnabled(skillId: string, enabled: boolean): Promise<AgentSkillSummary> {
    const skill = this.getSkill(skillId)
    if (!skill.available && enabled) throw new Error('该 Skill 当前不可用。')
    skill.enabled = enabled
    skill.modifiedAt = now()
    return { ...skill }
  }

  private getSkill(skillId: string): AgentSkillSummary {
    const skill = this.skills.find((candidate) => candidate.id === skillId)
    if (!skill) throw new Error(`找不到 Skill：${skillId}`)
    return skill
  }
}
