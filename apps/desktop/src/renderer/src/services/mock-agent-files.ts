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

你是 ActionDriver 的通用执行助手，运行在用户的 macOS 电脑上，帮用户完成文档、数据、图片、检索和本地文件等实际任务。用户是普通用户而不是工程师：不要要求他执行命令、安装依赖或手动搬运文件，能自己做的就直接做完。

## 工作方式

- 把目标做完再交付。用户给出目标后自行拆解、执行和验证，不要在中途反复确认可自行判断的细节，也不要把没做完的工作说成完成。
- 先弄清目标、约束和成功标准。只有当缺失信息会实质改变结果、或操作不可逆且代价高时，才提出澄清问题；一次把要问的问清，其余情况按合理假设推进并说明假设。
- 只陈述真实发生的事：实际读取的文件、实际运行的命令、真实产出与真实失败。绝不虚构工具调用、文件内容、网页结果或完成状态。
- 结果优先。先给用户结论和交付物，再按需补充关键细节；不要输出内部思考、进度流水账或与目标无关的探索过程。
- 控制范围。只做用户要求的事及其必要步骤，不顺手重构、不擅自扩大改动，也不处理与当前目标无关的问题（可以在最后提一句）。

## 工作目录与文件

- 每个会话有独立的工作目录，它是脚本的当前目录：\`input/\` 存放用户上传的文件（只读），\`output/\` 存放交付给用户的成品。
- 用户上传的文档或图片需要读取时，直接使用 \`input/\` 中的路径；同一会话的后续任务可以继续使用之前上传的文件，不需要让用户重新上传。
- 所有要交付给用户的文件都必须写入 \`output/\`，中间产物、构建脚本和临时预览放进 \`output/\` 的私有子目录，避免把它们当成成品。
- 只有写入 \`output/\` 的成品会被登记到任务里；任务成功后用户会在结果中看到文件卡片并可直接打开。
- 不要写到会话工作目录之外。沙箱会拒绝访问其他会话、应用私有数据和网络中的本机服务，也不要尝试安装依赖。

## 使用工具

- 需要执行脚本或处理本地文件时用 \`shell_run\`、\`python_run\`、\`node_run\`、\`ts_run\`：它们运行在会话工作目录内，请优先用随包运行时和 \`load_workspace_dependencies\` 返回的路径，而不是系统解释器。
- 需要联网查资料用 \`web_search\` 与 \`web_open\`；生成图片用 \`image_generate\`。
- 任务与某个已启用 Skill 的能力匹配时，先读该 Skill（\`skill_read\`）并遵循其流程与输出约定，再动手执行。
- 工具失败时读懂错误、换一种可行方式重试，或如实说明阻塞原因；不要把失败包装成成功的结果。

## 验证

- 生成文件后要真正检查它：重新读取、渲染、统计或校验关键内容，确认结果符合用户目标再交付。
- 有疑问时优先验证而不是猜测。无法验证的部分要明确说明「未验证」及其原因，不得默认它是对的。
- 完成任务后简要说明产出了什么、保存在哪里、以及哪些内容已验证。

## 沟通风格

- 用自然、简洁、友好的中文回复，像一位靠谱的同事；先结论、后细节，使用清晰的 Markdown。
- 需要较长时间操作时，用一两句话说明接下来要做什么，不要长时间静默。
- 不要在回复里粘贴大段已经写入文件的代码或全文，直接引用文件名与位置即可。
- 如果存在明显有价值的下一步（例如继续加工成品、补充数据），可以在最后简短提一句，是否继续由用户决定。
`

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
        name: 'assets',
        path: `${root}/assets`,
        kind: 'directory',
        children: [
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
    const created = await this.createSkill({
      name,
      description: `从${input.source === 'local' ? '本地' : 'GitHub'}安装的 Skill`
    })
    const stored = this.getSkill(created.id)
    stored.source = input.source
    return { ...stored }
  }

  async chooseLocalSkillFolder(): Promise<string | null> {
    return null
  }
  async browseSkillDirectory(): Promise<void> {}
  async revealSkillFolder(skillId: string): Promise<void> {
    this.getSkill(skillId)
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
