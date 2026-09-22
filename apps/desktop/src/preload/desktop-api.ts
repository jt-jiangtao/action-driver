import type {
  SkillControlCommand,
  SkillExecutionEvent,
  TaskProjection
} from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import type {
  ModelConnectionDraftDto,
  ModelConnectionDto,
  ModelConnectionTestResultDto,
  ModelIpcResponse,
  ModelOptionDto,
  ModelTestResultDto
} from '../shared/model-ipc-contract'
import { MODEL_IPC_CHANNELS } from '../shared/model-ipc-contract'
import type {
  LogDetailResult,
  LogIpcResponse,
  LogListRequest,
  LogListResult
} from '../shared/log-ipc-contract'
import { LOG_IPC_CHANNELS } from '../shared/log-ipc-contract'
import type {
  AgentAcceptedResult,
  AgentControlSkillResult,
  AgentEventMessage,
  AgentGetResult,
  AgentIpcResponse,
  AgentSubmitResult,
  AgentSubscriptionResult
} from '../shared/agent-ipc-contract'
import { AGENT_IPC_CHANNELS } from '../shared/agent-ipc-contract'
import {
  AGENT_FILES_IPC_CHANNELS,
  type AgentFileIpcResponse,
  type AgentFileNodeDto,
  type AgentSkillSummaryDto,
  type AgentTextFileDto,
  type CreateAgentSkillDto,
  type SaveAgentFileDto
} from '../shared/agent-files-contract'

export interface DesktopIpcBridge {
  invoke(channel: string, input: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

export interface AgentDesktopApi {
  submit(goal: string): Promise<AgentSubmitResult>
  get(taskId: string): Promise<TaskProjection | null>
  interrupt(taskId: string): Promise<void>
  continue(taskId: string): Promise<void>
  provideInput(taskId: string, value: unknown): Promise<void>
  controlSkill(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent>
  subscribe(
    taskId: string,
    afterCursor: number,
    listener: (event: RuntimeEvent) => void
  ): Promise<() => void>
}

export interface DesktopApi {
  getEnvironment(): { platform: NodeJS.Platform; version: string }
  agent: AgentDesktopApi
  modelConnections: ModelConnectionsDesktopApi
  logs: LogsDesktopApi
  agentFiles: AgentFilesDesktopApi
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

export interface LogsDesktopApi {
  list(request: LogListRequest): Promise<LogListResult>
  detail(eventId: string): Promise<LogDetailResult>
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

async function invokeAgent<T>(ipc: DesktopIpcBridge, channel: string, input: unknown): Promise<T> {
  return await traceInteraction(channel, async () => {
    const response = (await ipc.invoke(channel, input)) as AgentIpcResponse<T>
    if (!response.ok) return Promise.reject(response.error)
    return response.value
  })
}

async function invokeModel<T>(ipc: DesktopIpcBridge, channel: string, input: unknown): Promise<T> {
  return await traceInteraction(channel, async () => {
    const response = (await ipc.invoke(channel, input)) as ModelIpcResponse<T>
    if (!response.ok) return Promise.reject(response.error)
    return response.value
  })
}

async function invokeAgentFiles<T>(
  ipc: DesktopIpcBridge,
  channel: string,
  input: unknown
): Promise<T> {
  return await traceInteraction(channel, async () => {
    const response = (await ipc.invoke(channel, input)) as AgentFileIpcResponse<T>
    if (!response.ok) return Promise.reject(response.error)
    return response.value
  })
}

/**
 * Prints every renderer to service interaction to the console (visible in DevTools) so the same
 * traffic the service logs can be followed live while developing. Payloads are never printed.
 */
async function traceInteraction<T>(channel: string, operation: () => Promise<T>): Promise<T> {
  const environment = globalThis.process?.env
  const enabled = environment?.ACTIONDRIVER_LOG_CONSOLE !== '0' && environment?.NODE_ENV !== 'test'
  const startedAt = Date.now()
  if (enabled) console.debug(`[actiondriver] -> ${channel}`)
  try {
    const value = await operation()
    if (enabled) {
      console.debug(`[actiondriver] <- ${channel} ok (${Date.now() - startedAt}ms)`)
    }
    return value
  } catch (error) {
    if (enabled) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'unknown'
      console.warn(`[actiondriver] <- ${channel} error ${code} (${Date.now() - startedAt}ms)`)
    }
    throw error
  }
}

export function createDesktopApi(
  platform: NodeJS.Platform,
  version: string,
  ipc: DesktopIpcBridge,
  subscriptionIdFactory: () => string = () => globalThis.crypto.randomUUID()
): DesktopApi {
  return {
    getEnvironment: () => ({ platform, version }),
    agent: {
      submit: (goal) => invokeAgent<AgentSubmitResult>(ipc, AGENT_IPC_CHANNELS.submit, { goal }),
      async get(taskId) {
        const result = await invokeAgent<AgentGetResult>(ipc, AGENT_IPC_CHANNELS.get, { taskId })
        return result.task
      },
      async interrupt(taskId) {
        await invokeAgent<AgentAcceptedResult>(ipc, AGENT_IPC_CHANNELS.interrupt, { taskId })
      },
      async continue(taskId) {
        await invokeAgent<AgentAcceptedResult>(ipc, AGENT_IPC_CHANNELS.continue, { taskId })
      },
      async provideInput(taskId, value) {
        await invokeAgent<AgentAcceptedResult>(ipc, AGENT_IPC_CHANNELS.provideInput, {
          taskId,
          value
        })
      },
      async controlSkill(invocationId, command) {
        if (
          invocationId.length === 0 ||
          !(['pause', 'resume', 'take-over'] as const).includes(command)
        ) {
          return Promise.reject({
            code: 'INVALID_MESSAGE',
            message: 'Skill control requires an invocation id and a supported command'
          })
        }
        const result = await invokeAgent<AgentControlSkillResult>(
          ipc,
          AGENT_IPC_CHANNELS.controlSkill,
          { invocationId, command }
        )
        return result.event
      },
      async subscribe(taskId, afterCursor, listener) {
        const subscriptionId = subscriptionIdFactory()
        const handleEvent = (_event: unknown, payload: unknown) => {
          const message = payload as AgentEventMessage
          if (message.subscriptionId === subscriptionId) listener(message.event)
        }
        ipc.on(AGENT_IPC_CHANNELS.event, handleEvent)
        try {
          await invokeAgent<AgentSubscriptionResult>(ipc, AGENT_IPC_CHANNELS.subscribe, {
            subscriptionId,
            taskId,
            afterCursor
          })
        } catch (error) {
          ipc.off(AGENT_IPC_CHANNELS.event, handleEvent)
          throw error
        }
        return () => ipc.off(AGENT_IPC_CHANNELS.event, handleEvent)
      }
    },
    modelConnections: {
      list: () => invokeModel<ModelConnectionDto[]>(ipc, MODEL_IPC_CHANNELS.list, {}),
      testConnection: (draft) =>
        invokeModel<ModelConnectionTestResultDto>(ipc, MODEL_IPC_CHANNELS.testConnection, draft),
      discover: (draft) => invokeModel<ModelOptionDto[]>(ipc, MODEL_IPC_CHANNELS.discover, draft),
      refresh: (connectionId) =>
        invokeModel<ModelOptionDto[]>(ipc, MODEL_IPC_CHANNELS.refresh, { connectionId }),
      testModels: (draft, modelIds) =>
        invokeModel<ModelTestResultDto[]>(ipc, MODEL_IPC_CHANNELS.testModels, {
          draft,
          modelIds
        }),
      testConnectionModels: (connectionId, modelIds) =>
        invokeModel<ModelTestResultDto[]>(ipc, MODEL_IPC_CHANNELS.testConnectionModels, {
          connectionId,
          modelIds
        }),
      async setModelEnabled(connectionId, modelId, enabled) {
        await invokeModel<void>(ipc, MODEL_IPC_CHANNELS.setModelEnabled, {
          connectionId,
          modelId,
          enabled
        })
      },
      add: (draft, models) =>
        invokeModel<ModelConnectionDto>(ipc, MODEL_IPC_CHANNELS.add, { draft, models }),
      async delete(connectionId) {
        await invokeModel<void>(ipc, MODEL_IPC_CHANNELS.delete, { connectionId })
      }
    },
    logs: {
      async list(request) {
        const response = (await ipc.invoke(
          LOG_IPC_CHANNELS.list,
          request
        )) as LogIpcResponse<LogListResult>
        if (!response.ok) return Promise.reject(response.error)
        return response.value
      },
      async detail(eventId) {
        const response = (await ipc.invoke(LOG_IPC_CHANNELS.detail, {
          eventId
        })) as LogIpcResponse<LogDetailResult>
        if (!response.ok) return Promise.reject(response.error)
        return response.value
      }
    },
    agentFiles: {
      getMainPrompt: () =>
        invokeAgentFiles<AgentTextFileDto>(ipc, AGENT_FILES_IPC_CHANNELS.getMainPrompt, {}),
      resetMainPrompt: (expectedDigest) =>
        invokeAgentFiles<AgentTextFileDto>(ipc, AGENT_FILES_IPC_CHANNELS.resetMainPrompt, {
          expectedDigest
        }),
      listSkills: () =>
        invokeAgentFiles<AgentSkillSummaryDto[]>(ipc, AGENT_FILES_IPC_CHANNELS.listSkills, {}),
      getSkillTree: (skillId) =>
        invokeAgentFiles<AgentFileNodeDto[]>(ipc, AGENT_FILES_IPC_CHANNELS.getSkillTree, {
          skillId
        }),
      readFile: (path) =>
        invokeAgentFiles<AgentTextFileDto>(ipc, AGENT_FILES_IPC_CHANNELS.readFile, { path }),
      saveFile: (input) =>
        invokeAgentFiles<AgentTextFileDto>(ipc, AGENT_FILES_IPC_CHANNELS.saveFile, input),
      createSkill: (input) =>
        invokeAgentFiles<AgentSkillSummaryDto>(ipc, AGENT_FILES_IPC_CHANNELS.createSkill, input),
      renameSkill: (skillId, name) =>
        invokeAgentFiles<AgentSkillSummaryDto>(ipc, AGENT_FILES_IPC_CHANNELS.renameSkill, {
          skillId,
          name
        }),
      async deleteSkill(skillId) {
        await invokeAgentFiles<void>(ipc, AGENT_FILES_IPC_CHANNELS.deleteSkill, { skillId })
      },
      setSkillEnabled: (skillId, enabled) =>
        invokeAgentFiles<AgentSkillSummaryDto>(ipc, AGENT_FILES_IPC_CHANNELS.setSkillEnabled, {
          skillId,
          enabled
        })
    }
  }
}
