import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
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
} from '@actiondriver/runtime-contracts'
import { parseSkillDeclaration } from './skill-declaration'

const MANAGED_DIRECTORY = '.action-driver'
const MAIN_PROMPT_PATH = '.action-driver/prompts/main.md'
const SKILLS_PATH = '.action-driver/skills'
const BUILT_IN_SKILLS = new Set(['browser-tools', 'computer-tools', 'report-writer', 'skill-creator'])
const LEGACY_BUILT_INS = ['browser-tools', 'computer-tools', 'report-writer'] as const

const DEFAULT_PROMPT = `# ActionDriver 主提示词

你是 ActionDriver 的执行助手。你的职责是准确理解用户目标，在当前可用能力范围内完成任务，并返回可验证的结果。

## 工作原则

- 先识别用户目标、约束和成功标准；信息不足且会影响结果时，只提出必要的澄清问题。
- 能直接执行时立即行动，不重复确认，不输出内部执行进度。
- 只陈述已知事实、实际执行的操作和真实结果；不得虚构工具调用、外部结果或完成状态。
- 遇到不确定性时，明确说明假设、限制和风险；无法继续时说明具体阻塞点。
- 保持任务边界，不擅自扩大范围或执行无关操作。
- 优先给出结果，使用简洁、清晰的 Markdown；只有在有助于理解时才补充过程或细节。
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
  private readonly systemRoot: string
  private readonly systemSkillsSourceRoot: string
  private managedRootRealPath: string | null = null
  private readonly isExecutorRegistered: (executorId: string) => boolean

  constructor({
    homeDirectory,
    isExecutorRegistered = () => false,
    systemSkillsSourceRoot = join(process.cwd(), 'apps/agent-runtime/resources/system-skills')
  }: {
    homeDirectory: string
    isExecutorRegistered?: (executorId: string) => boolean
    systemSkillsSourceRoot?: string
  }) {
    this.managedRoot = join(homeDirectory, MANAGED_DIRECTORY)
    this.skillsRoot = join(this.managedRoot, 'skills')
    this.systemRoot = join(this.skillsRoot, '.system')
    this.systemSkillsSourceRoot = systemSkillsSourceRoot
    this.isExecutorRegistered = isExecutorRegistered
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.managedRoot, 'prompts'), { recursive: true })
    await mkdir(this.skillsRoot, { recursive: true })
    await mkdir(this.systemRoot, { recursive: true })
    this.managedRootRealPath = await realpath(this.managedRoot)
    await this.writeDefaultIfMissing(join(this.managedRoot, 'prompts', 'main.md'), DEFAULT_PROMPT)
    await this.migrateLegacyBuiltIns()
    for (const skill of DEFAULT_SKILLS) {
      const directory = join(this.systemRoot, skill.id)
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
    const creator = join(this.systemRoot, 'skill-creator')
    try {
      await lstat(creator)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await cp(join(this.systemSkillsSourceRoot, 'skill-creator'), creator, { recursive: true, errorOnExist: true })
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
    const [personal, system] = await Promise.all([
      readdir(this.skillsRoot, { withFileTypes: true }),
      readdir(this.systemRoot, { withFileTypes: true })
    ])
    const entries = [...personal.filter((entry) => !entry.name.startsWith('.')), ...system]
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          try {
            return await this.summarizeSkill(entry.name)
          } catch {
            return this.summarizeInvalidSkill(entry.name)
          }
        })
    )
    return skills.sort((left, right) => {
      const builtInDifference = Number(right.protected) - Number(left.protected)
      return builtInDifference || left.name.localeCompare(right.name)
    })
  }

  async getSkillTree(skillId: string): Promise<AgentFileNodeDto[]> {
    const publicPath = this.skillPublicPath(this.validateSkillId(skillId))
    const directory = await this.resolveExisting(publicPath)
    return this.readTree(directory, publicPath)
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
    const absolutePath = await this.resolveExisting(input.path)
    const withinSystem = relative(await realpath(this.systemRoot), absolutePath)
    if (withinSystem === '' || (!withinSystem.startsWith('..') && !isAbsolute(withinSystem))) {
      throw new AgentFileStoreError('PROTECTED', '系统 Skill 内容只读。')
    }
    const current = await this.readFile(input.path)
    if (current.digest !== input.expectedDigest) {
      throw new AgentFileStoreError('CONFLICT', '文件已在外部更改，请重新加载后再保存。')
    }
    await this.atomicWrite(absolutePath, input.content)
    return this.readFile(input.path)
  }

  async createSkill(input: CreateAgentSkillDto): Promise<AgentSkillSummaryDto> {
    const id = this.validateSkillId(input.name)
    this.assertMutable(id)
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
    this.assertMutable(nextId)
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
    const directory = await this.resolveExisting(this.skillPublicPath(id))
    await rm(directory, { recursive: true })
  }

  async setSkillEnabled(skillId: string, enabled: boolean): Promise<AgentSkillSummaryDto> {
    const id = this.validateSkillId(skillId)
    const directory = await this.resolveExisting(this.skillPublicPath(id))
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

  async listEnabledSkillDescriptions(): Promise<Array<{ skillId: string; description: string }>> {
    return (await this.listSkills())
      .filter((skill) => skill.available && skill.enabled)
      .map(({ id, description }) => ({ skillId: id, description }))
  }

  async readEnabledSkillFile(skillId: string, relativePath = 'SKILL.md'): Promise<AgentTextFileDto> {
    const id = this.validateSkillId(skillId)
    if (
      !relativePath || isAbsolute(relativePath) || relativePath.includes('\\') ||
      relativePath.split('/').some((part) => !part || part === '.' || part === '..')
    ) throw new AgentFileStoreError('PATH_REJECTED', 'Skill 文件路径无效。')
    const skill = (await this.listSkills()).find((item) => item.id === id)
    if (!skill?.available || !skill.enabled) {
      throw new AgentFileStoreError('VALIDATION', `Skill 未启用：${id}`)
    }
    const skillRoot = await realpath(join(BUILT_IN_SKILLS.has(id) ? this.systemRoot : this.skillsRoot, id))
    const requested = await realpath(join(skillRoot, relativePath))
    const withinSkill = relative(skillRoot, requested)
    if (withinSkill === '..' || withinSkill.startsWith(`..${sep}`) || isAbsolute(withinSkill)) {
      throw new AgentFileStoreError('PATH_REJECTED', 'Skill 文件路径越出当前目录。')
    }
    const file = await this.readFile(`${this.skillPublicPath(id)}/${relativePath}`)
    if (Buffer.byteLength(file.content, 'utf8') > 1024 * 1024) {
      throw new AgentFileStoreError('VALIDATION', 'Skill 文件超过读取上限。')
    }
    return file
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
    const skillFile = await this.readFile(`${this.skillPublicPath(id)}/SKILL.md`)
    const declaration = parseSkillDeclaration(skillFile.content)
    const disabled = await lstat(join(BUILT_IN_SKILLS.has(id) ? this.systemRoot : this.skillsRoot, id, '.disabled'))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      })
    const available = true
    const unavailableReason = null
    const source = BUILT_IN_SKILLS.has(id) ? 'builtin' : await this.readPersonalSource(id)
    return {
      id,
      name: declaration.name,
      description: declaration.description,
      source,
      enabled: available && !disabled,
      available,
      executorId: declaration.executorId,
      unavailableReason,
      protected: BUILT_IN_SKILLS.has(id),
      modifiedAt: skillFile.modifiedAt
    }
  }

  private async summarizeInvalidSkill(id: string): Promise<AgentSkillSummaryDto> {
    const directoryStat = await stat(join(BUILT_IN_SKILLS.has(id) ? this.systemRoot : this.skillsRoot, id))
    return {
      id,
      name: id,
      description: 'Skill 声明缺失或无法读取。',
      source: BUILT_IN_SKILLS.has(id) ? 'builtin' : 'local',
      enabled: false,
      available: false,
      executorId: null,
      unavailableReason: 'invalid-declaration',
      protected: BUILT_IN_SKILLS.has(id),
      modifiedAt: directoryStat.mtime.toISOString()
    }
  }

  private async readTree(
    absoluteDirectory: string,
    publicDirectory: string
  ): Promise<AgentFileNodeDto[]> {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    const visibleEntries = entries
      .filter((entry) => entry.name !== '.disabled' && entry.name !== '.action-driver-source.json')
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

  private skillPublicPath(id: string): string {
    return `${SKILLS_PATH}/${BUILT_IN_SKILLS.has(id) ? '.system/' : ''}${id}`
  }

  private async readPersonalSource(id: string): Promise<'local' | 'github'> {
    try {
      const raw = await readFile(join(this.skillsRoot, id, '.action-driver-source.json'), 'utf8')
      return JSON.parse(raw).source === 'github' ? 'github' : 'local'
    } catch {
      return 'local'
    }
  }

  private async migrateLegacyBuiltIns(): Promise<void> {
    for (const id of LEGACY_BUILT_INS) {
      const oldPath = join(this.skillsRoot, id)
      try {
        await lstat(oldPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const newPath = join(this.systemRoot, id)
      let destination = newPath
      try {
        await lstat(newPath)
        let suffix = 0
        do {
          destination = join(this.skillsRoot, `${id}-legacy${suffix ? `-${suffix}` : ''}`)
          suffix++
          try {
            await lstat(destination)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
            throw error
          }
        } while (true)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(oldPath, destination)
    }
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
    const path = join(this.systemRoot, skill.id, 'SKILL.md')
    const current = await readFile(path, 'utf8')
    const legacy = `# ${skill.id}\n\n${skill.description}\n\n## Usage\n\n当任务匹配该能力时使用。\n`
    if (current === legacy) await this.atomicWrite(path, this.defaultSkillContent(skill))
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
