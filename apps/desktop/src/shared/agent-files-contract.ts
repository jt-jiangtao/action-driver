export type AgentFileErrorCode =
  | 'CONFLICT'
  | 'PATH_REJECTED'
  | 'NOT_FOUND'
  | 'PROTECTED'
  | 'VALIDATION'
  | 'IO_ERROR'

export interface AgentFileErrorDto {
  code: AgentFileErrorCode
  message: string
}

export interface AgentFileNodeDto {
  name: string
  path: string
  kind: 'directory' | 'file'
  children?: AgentFileNodeDto[]
}

export interface AgentTextFileDto {
  path: string
  content: string
  digest: string
  modifiedAt: string
}

export interface AgentSkillSummaryDto {
  id: string
  name: string
  description: string
  enabled: boolean
  available: boolean
  protected: boolean
  modifiedAt: string
}

export interface SaveAgentFileDto {
  path: string
  content: string
  expectedDigest: string
}

export interface CreateAgentSkillDto {
  name: string
  description: string
}

export type AgentFileIpcResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: AgentFileErrorDto }

export const AGENT_FILES_IPC_CHANNELS = {
  getMainPrompt: 'actiondriver:agent-files:get-main-prompt',
  resetMainPrompt: 'actiondriver:agent-files:reset-main-prompt',
  listSkills: 'actiondriver:agent-files:list-skills',
  getSkillTree: 'actiondriver:agent-files:get-skill-tree',
  readFile: 'actiondriver:agent-files:read-file',
  saveFile: 'actiondriver:agent-files:save-file',
  createSkill: 'actiondriver:agent-files:create-skill',
  renameSkill: 'actiondriver:agent-files:rename-skill',
  deleteSkill: 'actiondriver:agent-files:delete-skill',
  setSkillEnabled: 'actiondriver:agent-files:set-skill-enabled'
} as const
