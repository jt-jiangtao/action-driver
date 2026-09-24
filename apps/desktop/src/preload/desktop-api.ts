import type {
  RecentTaskProjection, SkillControlCommand, SkillExecutionEvent, TaskProjection
} from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import type {
  ModelConnectionDraftDto, ModelConnectionDto, ModelConnectionTestResultDto,
  ModelOptionDto, ModelTestResultDto
} from '@actiondriver/model-connections'
import type {
  AgentFileNodeDto, AgentSkillSummaryDto, AgentTextFileDto, CreateAgentSkillDto,
  SaveAgentFileDto
} from '@actiondriver/runtime-contracts'
import {
  RUNTIME_CONNECTION_IPC_CHANNEL,
  type RuntimeConnectionDesktopApi, type RuntimeConnectionInfo
} from '../shared/runtime-connection-contract'

export interface DesktopIpcBridge {
  invoke(channel: string, input: unknown): Promise<unknown>
}

/** Business ports used by Renderer adapters; production implementations call Runtime HTTP/WS. */
export interface AgentDesktopApi {
  get(taskId: string): Promise<TaskProjection | null>
  listTasks(limit?: number): Promise<RecentTaskProjection[]>
  interrupt(taskId: string): Promise<void>
  continue(taskId: string): Promise<void>
  provideInput(taskId: string, value: unknown): Promise<void>
  controlSkill(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent>
  subscribe(taskId: string, afterCursor: number, listener: (event: RuntimeEvent) => void): Promise<() => void>
}

export interface ModelConnectionsDesktopApi {
  list(): Promise<ModelConnectionDto[]>
  testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto>
  discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]>
  refresh(connectionId: string): Promise<ModelOptionDto[]>
  testModels(draft: ModelConnectionDraftDto, modelIds: string[]): Promise<ModelTestResultDto[]>
  testConnectionModels(connectionId: string, modelIds: string[]): Promise<ModelTestResultDto[]>
  setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void>
  add(draft: ModelConnectionDraftDto, models: ModelOptionDto[]): Promise<ModelConnectionDto>
  delete(connectionId: string): Promise<void>
}

export interface AgentFilesDesktopApi {
  getMainPrompt(): Promise<AgentTextFileDto>
  resetMainPrompt(expectedDigest: string): Promise<AgentTextFileDto>
  listSkills(): Promise<AgentSkillSummaryDto[]>
  getSkillTree(skillId: string): Promise<AgentFileNodeDto[]>
  readFile(path: string): Promise<AgentTextFileDto>
  saveFile(input: SaveAgentFileDto): Promise<AgentTextFileDto>
  createSkill(input: CreateAgentSkillDto): Promise<AgentSkillSummaryDto>
  renameSkill(skillId: string, name: string): Promise<AgentSkillSummaryDto>
  deleteSkill(skillId: string): Promise<void>
  setSkillEnabled(skillId: string, enabled: boolean): Promise<AgentSkillSummaryDto>
}

/** Preload exposes only immutable environment details and the authenticated Runtime endpoint. */
export interface DesktopApi {
  getEnvironment(): { platform: NodeJS.Platform; version: string }
  runtimeConnection: RuntimeConnectionDesktopApi
}

export function createDesktopApi(
  platform: NodeJS.Platform,
  version: string,
  ipc: DesktopIpcBridge
): DesktopApi {
  return {
    getEnvironment: () => ({ platform, version }),
    runtimeConnection: {
      get: async () => await ipc.invoke(RUNTIME_CONNECTION_IPC_CHANNEL, {}) as RuntimeConnectionInfo
    }
  }
}
