export type AgentFileKind = 'directory' | 'file'

export interface AgentFileNode {
  name: string
  path: string
  kind: AgentFileKind
  children?: AgentFileNode[]
}

export interface AgentTextFile {
  path: string
  content: string
  digest: string
  modifiedAt: string
}

export interface AgentSkillSummary {
  id: string
  name: string
  description: string
  enabled: boolean
  available: boolean
  protected: boolean
  modifiedAt: string
}

export interface SaveAgentFileInput {
  path: string
  content: string
  expectedDigest: string
}

export interface CreateAgentSkillInput {
  name: string
  description: string
}

export class AgentFileConflictError extends Error {
  constructor(message = '文件已在外部更改，请重新加载后再保存。') {
    super(message)
    this.name = 'AgentFileConflictError'
  }
}

export class AgentFilePathError extends Error {
  constructor(message = '文件路径不在允许的 Agent 目录内。') {
    super(message)
    this.name = 'AgentFilePathError'
  }
}

export interface AgentFilesService {
  getMainPrompt(): Promise<AgentTextFile>
  listSkills(): Promise<AgentSkillSummary[]>
  getSkillTree(skillId: string): Promise<AgentFileNode[]>
  readFile(path: string): Promise<AgentTextFile>
  saveFile(input: SaveAgentFileInput): Promise<AgentTextFile>
  createSkill(input: CreateAgentSkillInput): Promise<AgentSkillSummary>
  renameSkill(skillId: string, name: string): Promise<AgentSkillSummary>
  deleteSkill(skillId: string): Promise<void>
  setSkillEnabled(skillId: string, enabled: boolean): Promise<AgentSkillSummary>
}
