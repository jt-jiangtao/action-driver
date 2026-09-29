import type {
  AppApprovalDecision,
  RecentTaskProjection,
  SkillControlCommand,
  SkillExecutionEvent,
  TaskProjection
} from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import type { ModelRef } from '@actiondriver/contracts'
import type {
  ModelConnectionDraftDto,
  ModelConnectionDto,
  ModelConnectionTestResultDto,
  ModelOptionDto,
  ModelTestResultDto
} from '@actiondriver/model-connections'
import type {
  AgentFileNodeDto,
  AgentSkillSummaryDto,
  AgentTextFileDto,
  CreateAgentSkillDto,
  SaveAgentFileDto,
  InstallSkillInput
} from '@actiondriver/runtime-contracts'
import {
  RUNTIME_CONNECTION_IPC_CHANNEL,
  type RuntimeConnectionDesktopApi,
  type RuntimeConnectionInfo
} from '../shared/runtime-connection-contract'
import {
  BROWSER_SESSION_COMMAND_CHANNEL,
  BROWSER_SESSION_EVENT_CHANNEL,
  BROWSER_SESSION_VIEWPORT_CHANNEL,
  type BrowserSessionEvent,
  type BrowserSessionRequest,
  type BrowserViewportRequest
} from '../shared/browser-session-contract'
import type { BrowserSessionSnapshot } from '@actiondriver/browser-desktop'
import {
  SKILL_FOLDER_BROWSE_CHANNEL,
  SKILL_FOLDER_CHOOSE_CHANNEL,
  SKILL_FOLDER_REVEAL_CHANNEL
} from '../shared/skill-folder-contract'
import { EXTERNAL_LINK_OPEN_CHANNEL } from '../shared/external-link-contract'
import { TASK_OUTPUT_OPEN_CHANNEL } from '../shared/task-output-contract'
import {
  PLUGIN_COMMAND_EXECUTE_CHANNEL,
  PLUGIN_CONTRIBUTIONS_LIST_CHANNEL,
  PLUGIN_VIEW_OPEN_CHANNEL,
  type PluginContributionsDesktopApi
} from '../shared/plugin-contributions-contract'
import type { PluginUiContributions } from '@actiondriver/plugin-contracts'
import {
  COMPUTER_APP_ICON_CHANNEL,
  COMPUTER_GUIDANCE_ENSURE_CHANNEL,
  COMPUTER_PERMISSIONS_CHECK_CHANNEL,
  COMPUTER_PERMISSIONS_SETTINGS_CHANNEL,
  type ComputerPermissionKey,
  type ComputerPermissionStatus
} from '../shared/computer-use-contract'

export interface DesktopIpcBridge {
  invoke(channel: string, input: unknown): Promise<unknown>
  on?(channel: string, listener: (value: unknown) => void): () => void
}

/** Business ports used by Renderer adapters; production implementations call Runtime HTTP/WS. */
export interface AgentDesktopApi {
  get(taskId: string): Promise<TaskProjection | null>
  listTasks(limit?: number): Promise<RecentTaskProjection[]>
  interrupt(taskId: string): Promise<void>
  continue(taskId: string): Promise<void>
  provideInput(taskId: string, value: unknown): Promise<void>
  decideAppApproval(taskId: string, requestId: string, decision: AppApprovalDecision): Promise<void>
  controlSkill(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent>
  subscribe(
    taskId: string,
    afterCursor: number,
    listener: (event: RuntimeEvent) => void
  ): Promise<() => void>
}

export interface ModelConnectionsDesktopApi {
  list(): Promise<ModelConnectionDto[]>
  testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto>
  discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]>
  refresh(connectionId: string): Promise<ModelOptionDto[]>
  testModels(draft: ModelConnectionDraftDto, modelIds: string[]): Promise<ModelTestResultDto[]>
  testConnectionModels(connectionId: string, modelIds: string[]): Promise<ModelTestResultDto[]>
  setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void>
  setDefaultImageModel(model: ModelRef | null): Promise<void>
  getDefaultImageModel(): Promise<ModelRef | null>
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
  installSkill(input: InstallSkillInput): Promise<AgentSkillSummaryDto>
  renameSkill(skillId: string, name: string): Promise<AgentSkillSummaryDto>
  deleteSkill(skillId: string): Promise<void>
  setSkillEnabled(skillId: string, enabled: boolean): Promise<AgentSkillSummaryDto>
}

/** Preload exposes only immutable environment details and the authenticated Runtime endpoint. */
export interface DesktopApi {
  getEnvironment(): { platform: NodeJS.Platform; version: string }
  runtimeConnection: RuntimeConnectionDesktopApi
  browserSession: {
    command(request: BrowserSessionRequest): Promise<BrowserSessionSnapshot | null>
    subscribe(listener: (event: BrowserSessionEvent) => void): () => void
    setViewport(request: BrowserViewportRequest): Promise<void>
  }
  skillFolders: {
    choose(): Promise<string | null>
    browse(): Promise<void>
    reveal(skillId: string): Promise<void>
  }
  externalLinks: { open(url: string): Promise<void> }
  taskOutput: {
    open(input: { fileId: string; taskId: string; sessionId: string }): Promise<void>
  }
  computerUse: {
    permissions(): Promise<ComputerPermissionStatus>
    requestPermissions(target: ComputerPermissionKey): Promise<ComputerPermissionStatus>
    openSystemSettings(): Promise<void>
    ensureGuidance(): Promise<unknown>
    /** Data URL of the application icon, or null when macOS cannot provide one. */
    getAppIcon(appPath: string): Promise<string | null>
  }
  pluginContributions: PluginContributionsDesktopApi
}

export function createDesktopApi(
  platform: NodeJS.Platform,
  version: string,
  ipc: DesktopIpcBridge
): DesktopApi {
  return {
    getEnvironment: () => ({ platform, version }),
    runtimeConnection: {
      get: async () =>
        (await ipc.invoke(RUNTIME_CONNECTION_IPC_CHANNEL, {})) as RuntimeConnectionInfo
    },
    browserSession: {
      setViewport: async (request) => {
        await ipc.invoke(BROWSER_SESSION_VIEWPORT_CHANNEL, request)
      },
      command: async (request) =>
        (await ipc.invoke(BROWSER_SESSION_COMMAND_CHANNEL, request)) as BrowserSessionSnapshot | null,
      subscribe(listener) {
        if (!ipc.on) throw new Error('BROWSER_SESSION_EVENTS_UNAVAILABLE')
        return ipc.on(BROWSER_SESSION_EVENT_CHANNEL, (value) =>
          listener(structuredClone(value) as BrowserSessionEvent))
      }
    },
    skillFolders: {
      choose: async () => (await ipc.invoke(SKILL_FOLDER_CHOOSE_CHANNEL, {})) as string | null,
      browse: async () => {
        await ipc.invoke(SKILL_FOLDER_BROWSE_CHANNEL, {})
      },
      reveal: async (skillId) => {
        await ipc.invoke(SKILL_FOLDER_REVEAL_CHANNEL, { skillId })
      }
    },
    externalLinks: {
      open: async (url) => {
        await ipc.invoke(EXTERNAL_LINK_OPEN_CHANNEL, url)
      }
    },
    taskOutput: {
      open: async (input) => {
        await ipc.invoke(TASK_OUTPUT_OPEN_CHANNEL, input)
      }
    },
    computerUse: {
      permissions: async () =>
        (await ipc.invoke(COMPUTER_PERMISSIONS_CHECK_CHANNEL, {})) as ComputerPermissionStatus,
      requestPermissions: async (target) =>
        (await ipc.invoke(COMPUTER_PERMISSIONS_CHECK_CHANNEL, {
          prompt: true,
          target
        })) as ComputerPermissionStatus,
      openSystemSettings: async () => {
        await ipc.invoke(COMPUTER_PERMISSIONS_SETTINGS_CHANNEL, {})
      },
      ensureGuidance: async () => ipc.invoke(COMPUTER_GUIDANCE_ENSURE_CHANNEL, {}),
      getAppIcon: async (appPath) =>
        (await ipc.invoke(COMPUTER_APP_ICON_CHANNEL, { appPath })) as string | null
    },
    pluginContributions: {
      list: async () =>
        (await ipc.invoke(PLUGIN_CONTRIBUTIONS_LIST_CHANNEL, {})) as PluginUiContributions,
      openView: async (pluginId, viewId) => {
        await ipc.invoke(PLUGIN_VIEW_OPEN_CHANNEL, { pluginId, viewId })
      },
      executeCommand: async (input) => ipc.invoke(PLUGIN_COMMAND_EXECUTE_CHANNEL, input)
    }
  }
}
