import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type { AgentSkillSummaryDto, InstallSkillInput } from '@actiondriver/runtime-contracts'
import { AgentFileStore, AgentFileStoreError } from './agent-file-store'
import { parseSkillDeclaration } from './skill-declaration'

const MAX_FILES = 256
const MAX_BYTES = 10 * 1024 * 1024
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SYSTEM_SKILL_IDS = new Set(['browser-tools', 'computer-tools', 'report-writer', 'skill-creator'])

export class SkillInstaller {
  private readonly skillsRoot: string

  constructor(private readonly options: { homeDirectory: string; store: AgentFileStore }) {
    this.skillsRoot = join(options.homeDirectory, '.action-driver', 'skills')
  }

  async installSkill(input: InstallSkillInput): Promise<AgentSkillSummaryDto> {
    if (input.source !== 'local') {
      throw new AgentFileStoreError('VALIDATION', '暂不支持该 Skill 来源。')
    }
    return this.installDirectory(input.path, 'local')
  }

  async installDirectory(sourcePath: string, source: 'local' | 'github'): Promise<AgentSkillSummaryDto> {
    const id = basename(sourcePath).toLowerCase()
    if (!SKILL_ID.test(id)) throw new AgentFileStoreError('VALIDATION', 'Skill 目录名无效。')
    if (SYSTEM_SKILL_IDS.has(id)) throw new AgentFileStoreError('PROTECTED', '系统 Skill 名称不能用于安装。')
    const destination = join(this.skillsRoot, id)
    const sourceStat = await lstat(sourcePath)
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
      throw new AgentFileStoreError('VALIDATION', 'Skill 来源必须是普通文件夹。')
    }
    const sourceRoot = await realpath(sourcePath)
    const skillsRoot = await realpath(this.skillsRoot)
    if (sourceRoot === destination || sourceRoot === skillsRoot) {
      throw new AgentFileStoreError('VALIDATION', '不能从目标 Skill 目录安装自身。')
    }
    await this.assertDestinationAbsent(destination, id)
    const files = await this.collectFiles(sourceRoot)
    if (!files.includes('SKILL.md')) {
      throw new AgentFileStoreError('VALIDATION', 'Skill 文件夹缺少 SKILL.md。')
    }
    try {
      parseSkillDeclaration(await readFile(join(sourceRoot, 'SKILL.md'), 'utf8'))
    } catch (error) {
      throw new AgentFileStoreError('VALIDATION', 'SKILL.md 声明无效。', error)
    }
    const staging = join(skillsRoot, `.install-${randomUUID()}`)
    try {
      await mkdir(staging)
      for (const file of files) {
        const output = join(staging, file)
        await mkdir(join(output, '..'), { recursive: true })
        await copyFile(join(sourceRoot, file), output)
      }
      await writeFile(join(staging, '.action-driver-source.json'), JSON.stringify({ source }))
      await this.assertDestinationAbsent(destination, id)
      await rename(staging, destination)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    const installed = (await this.options.store.listSkills()).find((skill) => skill.id === id)
    if (!installed) throw new AgentFileStoreError('IO_ERROR', 'Skill 安装后无法读取。')
    return installed
  }

  private async assertDestinationAbsent(destination: string, id: string): Promise<void> {
    try {
      await lstat(destination)
      throw new AgentFileStoreError('CONFLICT', `Skill 已存在：${id}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async collectFiles(root: string): Promise<string[]> {
    const files: string[] = []
    let bytes = 0
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        const current = await lstat(path)
        if (current.isSymbolicLink() || (!current.isFile() && !current.isDirectory())) {
          throw new AgentFileStoreError('PATH_REJECTED', 'Skill 文件夹不支持符号链接或特殊文件。')
        }
        const fromRoot = relative(root, path)
        if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
          throw new AgentFileStoreError('PATH_REJECTED', 'Skill 文件越出来源目录。')
        }
        if (current.isDirectory()) await visit(path)
        else {
          files.push(fromRoot)
          bytes += current.size
          if (files.length > MAX_FILES || bytes > MAX_BYTES) {
            throw new AgentFileStoreError('VALIDATION', 'Skill 文件数量或大小超过上限。')
          }
        }
      }
    }
    await visit(root)
    return files
  }
}
