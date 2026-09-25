import {
  AgentFileConflictError,
  AgentFilePathError,
  type AgentFileNode,
  type AgentFilesService,
  type AgentSkillSummary,
  type AgentTextFile,
  type CreateAgentSkillInput,
  type InstallSkillInput,
  type SaveAgentFileInput
} from '../models/agent-files'

const MAIN_PROMPT_PATH = '.action-driver/prompts/main.md'
const SKILLS_ROOT = '.action-driver/skills/'
const skillRoot = (skill: AgentSkillSummary): string =>
  `${SKILLS_ROOT}${skill.source === 'builtin' ? '.system/' : ''}${skill.id}`
const DEFAULT_MAIN_PROMPT = `# ActionDriver 主提示词

你是 ActionDriver 的执行助手。你的职责是准确理解用户目标，在当前可用能力范围内完成任务，并返回可验证的结果。

## 工作原则

- 先识别用户目标、约束和成功标准；信息不足且会影响结果时，只提出必要的澄清问题。
- 能直接执行时立即行动，不重复确认，不输出内部执行进度。
- 只陈述已知事实、实际执行的操作和真实结果；不得虚构工具调用、外部结果或完成状态。
- 遇到不确定性时，明确说明假设、限制和风险；无法继续时说明具体阻塞点。
- 保持任务边界，不擅自扩大范围或执行无关操作。
- 优先给出结果，使用简洁、清晰的 Markdown；只有在有助于理解时才补充过程或细节。`

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
  ...(['documents', 'pdf', 'presentations', 'spreadsheets'] as const).map((id) => ({
    id,
    source: 'builtin' as const,
    name: id,
    description: `使用 ${id} 系统 Skill 处理文档。`,
    enabled: true,
    available: true,
    executorId: null,
    unavailableReason: null,
    protected: true,
    modifiedAt: '2026-09-25T09:30:00.000Z'
  })),
  {
    id: 'imagegen',
    source: 'builtin',
    name: 'Imagegen',
    description: '使用生图工具创建图片。',
    enabled: true,
    available: true,
    executorId: null,
    unavailableReason: null,
    protected: true,
    modifiedAt: '2026-09-25T09:30:00.000Z'
  },
  {
    id: 'skill-creator',
    source: 'builtin',
    name: 'Skill Creator',
    description: '创建可复用的 Skill，并从本地文件夹安装。',
    enabled: true,
    available: true,
    executorId: null,
    unavailableReason: null,
    protected: true,
    modifiedAt: '2026-09-20T09:30:00.000Z'
  },
  {
    id: 'data-inspector',
    source: 'local',
    name: 'data-inspector',
    description: '检查本地数据文件并输出质量摘要。',
    enabled: false,
    available: true,
    executorId: null,
    unavailableReason: null,
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
          `${skillRoot(skill)}/SKILL.md`,
          {
            content: `# ${skill.name}\n\n${skill.description}\n\n## Usage\n\n当任务匹配该能力时使用。`,
            modifiedAt: skill.modifiedAt
          }
        ],
        [
          `${skillRoot(skill)}/references/README.md`,
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
    const root = skillRoot(this.getSkill(skillId))
    const nodes: AgentFileNode[] = [
      { name: 'SKILL.md', path: `${root}/SKILL.md`, kind: 'file' },
      {
        name: 'references',
        path: `${root}/references`,
        kind: 'directory',
        children: [
          {
            name: 'README.md',
            path: `${root}/references/README.md`,
            kind: 'file'
          }
        ]
      }
    ]
    if (skillId === 'skill-creator') {
      nodes.push({
        name: 'assets', path: `${root}/assets`, kind: 'directory', children: [
          { name: 'skill-creator.png', path: `${root}/assets/skill-creator.png`, kind: 'file' }
        ]
      })
    }
    return nodes
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
    if (input.path.startsWith(`${SKILLS_ROOT}.system/`)) throw new AgentFilePathError()
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
      source: 'local',
      name: id,
      description: input.description.trim() || '暂无描述',
      enabled: true,
      available: true,
      executorId: null,
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

  async installSkill(input: InstallSkillInput): Promise<AgentSkillSummary> {
    const value = input.source === 'local' ? input.path : new URL(input.url).pathname
    const name = value.split('/').filter(Boolean).at(-1) ?? ''
    const created = await this.createSkill({ name, description: `从${input.source === 'local' ? '本地' : 'GitHub'}安装的 Skill` })
    const stored = this.getSkill(created.id)
    stored.source = input.source
    return { ...stored }
  }

  async chooseLocalSkillFolder(): Promise<string | null> { return null }
  async browseSkillDirectory(): Promise<void> {}
  async revealSkillFolder(skillId: string): Promise<void> { this.getSkill(skillId) }

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
