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
  source: 'builtin' | 'local' | 'github'
  enabled: boolean
  available: boolean
  executorId: string | null
  unavailableReason:
    | 'missing-executor'
    | 'invalid-executor'
    | 'executor-unregistered'
    | 'invalid-declaration'
    | null
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

export type InstallSkillInput =
  | { source: 'local'; path: string }
  | { source: 'github'; url: string }
