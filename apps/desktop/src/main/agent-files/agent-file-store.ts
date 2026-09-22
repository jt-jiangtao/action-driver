import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  AgentFileErrorCode,
  AgentFileNodeDto,
  AgentSkillSummaryDto,
  AgentTextFileDto,
  CreateAgentSkillDto,
  SaveAgentFileDto
} from '../../shared/agent-files-contract'

const MANAGED_DIRECTORY = '.action-driver'
const MAIN_PROMPT_PATH = '.action-driver/prompts/main.md'
const SKILLS_PATH = '.action-driver/skills'
const BUILT_IN_SKILLS = new Set(['browser-tools', 'computer-tools', 'report-writer'])

const DEFAULT_PROMPT = `# ActionDriver 主提示词

你是 ActionDriver 中的执行助手。

## 原则

- 在执行前确认用户目标。
- 记录每一次模型与工具调用。
- 当结果不确定时，说明假设与边界。
`

const DEFAULT_SKILLS = [
  {
    id: 'browser-tools',
    description: '通过浏览器搜索、读取并整理网页信息。',
    executorId: 'browser-use'
  },
  {
    id: 'computer-tools',
    description: '操作桌面应用并完成本地交互。',
    executorId: 'computer-use'
  },
  {
    id: 'report-writer',
    description: '将任务结果组织为结构化 Markdown 报告。',
    executorId: null
  }
] as const

type SkillUnavailableReason = AgentSkillSummaryDto['unavailableReason']

type SkillDeclaration = {
  body: string
  executorId: string | null
  unavailableReason: Extract<SkillUnavailableReason, 'missing-executor' | 'invalid-executor'> | null
}

export class AgentFileStoreError extends Error {
  constructor(
    readonly code: AgentFileErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AgentFileStoreError'
  }
}

export class AgentFileStore {
  private readonly managedRoot: string
  private readonly skillsRoot: string
  private managedRootRealPath: string | null = null
  private readonly isExecutorRegistered: (executorId: string) => boolean

  constructor({
    homeDirectory,
    isExecutorRegistered = () => false
  }: {
    homeDirectory: string
    isExecutorRegistered?: (executorId: string) => boolean
  }) {
    this.managedRoot = join(homeDirectory, MANAGED_DIRECTORY)
    this.skillsRoot = join(this.managedRoot, 'skills')
    this.isExecutorRegistered = isExecutorRegistered
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.managedRoot, 'prompts'), { recursive: true })
    await mkdir(this.skillsRoot, { recursive: true })
    this.managedRootRealPath = await realpath(this.managedRoot)
    await this.writeDefaultIfMissing(join(this.managedRoot, 'prompts', 'main.md'), DEFAULT_PROMPT)
    for (const skill of DEFAULT_SKILLS) {
      const directory = join(this.skillsRoot, skill.id)
      await mkdir(directory, { recursive: true })
      await this.writeDefaultIfMissing(
        join(directory, 'SKILL.md'),
        this.defaultSkillContent(skill)
      )
      if (skill.executorId) await this.migrateDefaultExecutor(skill)
      const references = join(directory, 'references')
      await mkdir(references, { recursive: true })
      await this.writeDefaultIfMissing(
        join(references, 'README.md'),
        `# ${skill.id} references\n\n在这里放置该 Skill 使用的参考资料。\n`
      )
    }
  }

  async getMainPrompt(): Promise<AgentTextFileDto> {
    return this.readFile(MAIN_PROMPT_PATH)
  }

  async resetMainPrompt(expectedDigest: string): Promise<AgentTextFileDto> {
    return this.saveFile({ path: MAIN_PROMPT_PATH, content: DEFAULT_PROMPT, expectedDigest })
  }

  async listSkills(): Promise<AgentSkillSummaryDto[]> {
    this.assertInitialized()
    const entries = await readdir(this.skillsRoot, { withFileTypes: true })
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => this.summarizeSkill(entry.name))
    )
    return skills.sort((left, right) => {
      const builtInDifference = Number(right.protected) - Number(left.protected)
      return builtInDifference || left.name.localeCompare(right.name)
    })
  }

  async getSkillTree(skillId: string): Promise<AgentFileNodeDto[]> {
    const directory = await this.resolveExisting(`${SKILLS_PATH}/${this.validateSkillId(skillId)}`)
    return this.readTree(directory, `${SKILLS_PATH}/${skillId}`)
  }

  async readFile(path: string): Promise<AgentTextFileDto> {
    const absolutePath = await this.resolveExisting(path)
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile()) throw new AgentFileStoreError('NOT_FOUND', `找不到文件：${path}`)
    const content = await readFile(absolutePath, 'utf8')
    return {
      path,
      content,
      digest: this.digest(content),
      modifiedAt: fileStat.mtime.toISOString()
    }
  }

  async saveFile(input: SaveAgentFileDto): Promise<AgentTextFileDto> {
    const current = await this.readFile(input.path)
    if (current.digest !== input.expectedDigest) {
      throw new AgentFileStoreError('CONFLICT', '文件已在外部更改，请重新加载后再保存。')
    }
    const absolutePath = await this.resolveExisting(input.path)
    await this.atomicWrite(absolutePath, input.content)
    return this.readFile(input.path)
  }

  async createSkill(input: CreateAgentSkillDto): Promise<AgentSkillSummaryDto> {
    const id = this.validateSkillId(input.name)
    const directory = await this.resolveForCreation(`${SKILLS_PATH}/${id}`)
    try {
      await mkdir(directory)
    } catch (error) {
      throw new AgentFileStoreError('VALIDATION', `Skill 已存在：${id}`, error)
    }
    const description = input.description.trim() || '暂无描述'
    await this.atomicWrite(join(directory, 'SKILL.md'), `# ${id}\n\n${description}\n`)
    await this.atomicWrite(join(directory, '.disabled'), 'disabled\n')
    await mkdir(join(directory, 'references'))
    await this.atomicWrite(join(directory, 'references', 'README.md'), '# References\n')
    return this.summarizeSkill(id)
  }

  async renameSkill(skillId: string, name: string): Promise<AgentSkillSummaryDto> {
    const currentId = this.validateSkillId(skillId)
    this.assertMutable(currentId)
    const nextId = this.validateSkillId(name)
    const source = await this.resolveExisting(`${SKILLS_PATH}/${currentId}`)
    const destination = await this.resolveForCreation(`${SKILLS_PATH}/${nextId}`)
    try {
      await rename(source, destination)
    } catch (error) {
      throw new AgentFileStoreError('VALIDATION', `无法将 Skill 重命名为 ${nextId}。`, error)
    }
    return this.summarizeSkill(nextId)
  }

  async deleteSkill(skillId: string): Promise<void> {
    const id = this.validateSkillId(skillId)
    this.assertMutable(id)
    const directory = await this.resolveExisting(`${SKILLS_PATH}/${id}`)
    await rm(directory, { recursive: true })
  }

  async setSkillEnabled(skillId: string, enabled: boolean): Promise<AgentSkillSummaryDto> {
    const id = this.validateSkillId(skillId)
    const directory = await this.resolveExisting(`${SKILLS_PATH}/${id}`)
    const summary = await this.summarizeSkill(id)
    if (enabled && !summary.available) {
      throw new AgentFileStoreError(
        'VALIDATION',
        `CAPABILITY_UNAVAILABLE: ${summary.executorId ?? id}`
      )
    }
    const marker = join(directory, '.disabled')
    if (enabled)
      await unlink(marker).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    else await this.atomicWrite(marker, 'disabled\n')
    return this.summarizeSkill(id)
  }

  async getEnabledExecutors(): Promise<Array<{ skillId: string; description: string }>> {
    const executors = new Map<string, { skillId: string; description: string }>()
    for (const skill of await this.listSkills()) {
      if (!skill.enabled || !skill.available || skill.executorId === null) continue
      if (!executors.has(skill.executorId)) {
        executors.set(skill.executorId, {
          skillId: skill.executorId,
          description: skill.description
        })
      }
    }
    return [...executors.values()]
  }

  async assertExecutorEnabled(executorId: string): Promise<void> {
    const enabled = (await this.listSkills()).some(
      (skill) => skill.executorId === executorId && skill.available && skill.enabled
    )
    if (!enabled) {
      throw new AgentFileStoreError('VALIDATION', `CAPABILITY_UNAVAILABLE: ${executorId}`)
    }
  }

  private async summarizeSkill(id: string): Promise<AgentSkillSummaryDto> {
    const skillFile = await this.readFile(`${SKILLS_PATH}/${id}/SKILL.md`)
    const declaration = this.parseSkillDeclaration(skillFile.content)
    const description =
      declaration.body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith('#')) ?? '暂无描述'
    const disabled = await lstat(join(this.skillsRoot, id, '.disabled'))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      })
    const available =
      declaration.executorId !== null && this.isExecutorRegistered(declaration.executorId)
    const unavailableReason: SkillUnavailableReason =
      declaration.unavailableReason ??
      (declaration.executorId !== null && !available ? 'executor-unregistered' : null)
    return {
      id,
      name: id,
      description,
      enabled: available && !disabled,
      available,
      executorId: declaration.executorId,
      unavailableReason,
      protected: BUILT_IN_SKILLS.has(id),
      modifiedAt: skillFile.modifiedAt
    }
  }

  private async readTree(
    absoluteDirectory: string,
    publicDirectory: string
  ): Promise<AgentFileNodeDto[]> {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    const visibleEntries = entries
      .filter((entry) => entry.name !== '.disabled')
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name)
      })
    return Promise.all(
      visibleEntries.map(async (entry): Promise<AgentFileNodeDto> => {
        const publicPath = `${publicDirectory}/${entry.name}`
        if (entry.isSymbolicLink()) {
          await this.resolveExisting(publicPath)
          throw new AgentFileStoreError('PATH_REJECTED', '不支持在 Agent 文件树中使用符号链接。')
        }
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: publicPath,
            kind: 'directory',
            children: await this.readTree(join(absoluteDirectory, entry.name), publicPath)
          }
        }
        return { name: entry.name, path: publicPath, kind: 'file' }
      })
    )
  }

  private async resolveExisting(publicPath: string): Promise<string> {
    const lexicalPath = this.resolveLexically(publicPath)
    try {
      const resolvedPath = await realpath(lexicalPath)
      this.assertInsideRoot(resolvedPath)
      return resolvedPath
    } catch (error) {
      if (error instanceof AgentFileStoreError) throw error
      const code = (error as NodeJS.ErrnoException).code
      throw new AgentFileStoreError(
        code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR',
        `无法读取：${publicPath}`,
        error
      )
    }
  }

  private async resolveForCreation(publicPath: string): Promise<string> {
    const lexicalPath = this.resolveLexically(publicPath)
    const parent = await realpath(resolve(lexicalPath, '..'))
    this.assertInsideRoot(parent)
    return lexicalPath
  }

  private resolveLexically(publicPath: string): string {
    this.assertInitialized()
    if (
      isAbsolute(publicPath) ||
      publicPath.includes('\\') ||
      publicPath.split('/').includes('..') ||
      (publicPath !== MANAGED_DIRECTORY && !publicPath.startsWith(`${MANAGED_DIRECTORY}/`))
    ) {
      throw new AgentFileStoreError('PATH_REJECTED', '文件路径不在允许的 Agent 目录内。')
    }
    const absolutePath = resolve(this.managedRootRealPath!, relative(MANAGED_DIRECTORY, publicPath))
    this.assertInsideRoot(absolutePath)
    return absolutePath
  }

  private assertInsideRoot(path: string): void {
    this.assertInitialized()
    const pathFromRoot = relative(this.managedRootRealPath!, path)
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
      throw new AgentFileStoreError('PATH_REJECTED', '文件路径不在允许的 Agent 目录内。')
    }
  }

  private validateSkillId(value: string): string {
    const id = value.trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new AgentFileStoreError('VALIDATION', 'Skill 名称只能使用小写英文、数字和单个连字符。')
    }
    return id
  }

  private assertMutable(id: string): void {
    if (BUILT_IN_SKILLS.has(id)) {
      throw new AgentFileStoreError('PROTECTED', '内置 Skill 不能重命名或删除。')
    }
  }

  private assertInitialized(): void {
    if (!this.managedRootRealPath)
      throw new AgentFileStoreError('IO_ERROR', 'Agent 文件服务尚未初始化。')
  }

  private async writeDefaultIfMissing(path: string, content: string): Promise<void> {
    try {
      const handle = await open(path, 'wx')
      await handle.writeFile(content, 'utf8')
      await handle.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  private defaultSkillContent(skill: (typeof DEFAULT_SKILLS)[number]): string {
    const frontmatter = skill.executorId ? `---\nexecutor: ${skill.executorId}\n---\n` : ''
    return `${frontmatter}# ${skill.id}\n\n${skill.description}\n\n## Usage\n\n当任务匹配该能力时使用。\n`
  }

  private async migrateDefaultExecutor(skill: (typeof DEFAULT_SKILLS)[number]): Promise<void> {
    if (!skill.executorId) return
    const path = join(this.skillsRoot, skill.id, 'SKILL.md')
    const current = await readFile(path, 'utf8')
    const legacy = `# ${skill.id}\n\n${skill.description}\n\n## Usage\n\n当任务匹配该能力时使用。\n`
    if (current === legacy) await this.atomicWrite(path, this.defaultSkillContent(skill))
  }

  private parseSkillDeclaration(content: string): SkillDeclaration {
    if (!content.startsWith('---')) {
      return { body: content, executorId: null, unavailableReason: 'missing-executor' }
    }
    const lines = content.split(/\r?\n/)
    const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (closingIndex < 0) {
      return { body: content, executorId: null, unavailableReason: 'invalid-executor' }
    }
    const executorLine = lines
      .slice(1, closingIndex)
      .find((line) => /^executor\s*:/.test(line.trim()))
    const rawExecutor = executorLine
      ?.trim()
      .replace(/^executor\s*:\s*/, '')
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim()
    const body = lines.slice(closingIndex + 1).join('\n')
    if (!rawExecutor) return { body, executorId: null, unavailableReason: 'missing-executor' }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawExecutor)) {
      return { body, executorId: null, unavailableReason: 'invalid-executor' }
    }
    return { body, executorId: rawExecutor, unavailableReason: null }
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
      await rename(temporaryPath, path)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw new AgentFileStoreError('IO_ERROR', `无法保存文件：${path}`, error)
    }
  }

  private digest(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }
}
