import type { AgentFilesDesktopApi } from '../../../../preload/desktop-api'
import {
  AgentFileConflictError,
  AgentFileIoError,
  AgentFilePathError,
  type AgentFilesService,
  type CreateAgentSkillInput,
  type InstallSkillInput,
  type SaveAgentFileInput
} from '../../models/agent-files'

type StructuredError = { code?: unknown; message?: unknown }

export function mapAgentFileError(error: unknown): Error {
  const structured = error as StructuredError
  const message = typeof structured?.message === 'string' ? structured.message : String(error)
  if (structured?.code === 'CONFLICT') return new AgentFileConflictError(message)
  if (structured?.code === 'PATH_REJECTED') return new AgentFilePathError(message)
  if (structured?.code === 'IO_ERROR') return new AgentFileIoError(message)
  return new Error(message)
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw mapAgentFileError(error)
  }
}

export class DesktopAgentFilesService implements AgentFilesService {
  constructor(private readonly api: AgentFilesDesktopApi) {}

  getMainPrompt() {
    return call(() => this.api.getMainPrompt())
  }

  resetMainPrompt(expectedDigest: string) {
    return call(() => this.api.resetMainPrompt(expectedDigest))
  }

  listSkills() {
    return call(() => this.api.listSkills())
  }

  getSkillTree(skillId: string) {
    return call(() => this.api.getSkillTree(skillId))
  }

  readFile(path: string) {
    return call(() => this.api.readFile(path))
  }

  saveFile(input: SaveAgentFileInput) {
    return call(() => this.api.saveFile(input))
  }

  createSkill(input: CreateAgentSkillInput) {
    return call(() => this.api.createSkill(input))
  }

  installSkill(input: InstallSkillInput) {
    return call(() => this.api.installSkill(input))
  }

  chooseLocalSkillFolder() { return window.productDesktop.skillFolders.choose() }
  browseSkillDirectory() { return window.productDesktop.skillFolders.browse() }
  revealSkillFolder(skillId: string) { return window.productDesktop.skillFolders.reveal(skillId) }

  renameSkill(skillId: string, name: string) {
    return call(() => this.api.renameSkill(skillId, name))
  }

  deleteSkill(skillId: string) {
    return call(() => this.api.deleteSkill(skillId))
  }

  setSkillEnabled(skillId: string, enabled: boolean) {
    return call(() => this.api.setSkillEnabled(skillId, enabled))
  }
}
