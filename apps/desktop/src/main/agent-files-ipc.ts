import type { InteractionLogger } from '@actiondriver/observability'
import {
  AGENT_FILES_IPC_CHANNELS,
  type AgentFileErrorDto,
  type AgentFileIpcResponse,
  type CreateAgentSkillDto,
  type SaveAgentFileDto
} from '../shared/agent-files-contract'
import { AgentFileStoreError } from './agent-files/agent-file-store'
import type { AgentFileStore } from './agent-files/agent-file-store'

export interface AgentFilesIpcMain {
  handle(channel: string, handler: (event: unknown, input: unknown) => unknown): void
}

function serializeError(error: unknown): AgentFileErrorDto {
  if (error instanceof AgentFileStoreError) return { code: error.code, message: error.message }
  return {
    code: 'IO_ERROR',
    message: error instanceof Error ? error.message : String(error)
  }
}

async function respond<T>(
  channel: string,
  operation: () => Promise<T> | T,
  interactions?: InteractionLogger
): Promise<AgentFileIpcResponse<T>> {
  const finish = interactions?.start({
    transport: 'ipc',
    direction: 'renderer->service',
    operation: channel
  })
  try {
    const value = await operation()
    finish?.({ outcome: 'ok', payload: value })
    return { ok: true, value }
  } catch (error) {
    const serialized = serializeError(error)
    finish?.({ outcome: 'error', error: serialized })
    return { ok: false, error: serialized }
  }
}

function assertTrustedEvent(event: unknown): void {
  if (!event || typeof event !== 'object' || !('senderFrame' in event)) return
  const senderFrame = (event as { senderFrame?: { url?: unknown } }).senderFrame
  const url = typeof senderFrame?.url === 'string' ? senderFrame.url : ''
  if (
    url.startsWith('file:') ||
    url.startsWith('http://localhost:') ||
    url.startsWith('http://127.0.0.1:')
  ) {
    return
  }
  throw new AgentFileStoreError('PATH_REJECTED', '不允许的 Agent 文件 IPC 来源。')
}

function secureRespond<T>(
  event: unknown,
  channel: string,
  operation: () => Promise<T> | T,
  interactions?: InteractionLogger
): Promise<AgentFileIpcResponse<T>> {
  return respond(
    channel,
    () => {
      assertTrustedEvent(event)
      return operation()
    },
    interactions
  )
}

export function registerAgentFilesIpcHandlers(
  ipcMain: AgentFilesIpcMain,
  store: AgentFileStore,
  interactions?: InteractionLogger
): void {
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.getMainPrompt, (event) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.getMainPrompt,
      () => store.getMainPrompt(),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.listSkills, (event) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.listSkills,
      () => store.listSkills(),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.getSkillTree, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.getSkillTree,
      () => store.getSkillTree((input as { skillId: string }).skillId),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.readFile, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.readFile,
      () => store.readFile((input as { path: string }).path),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.saveFile, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.saveFile,
      () => store.saveFile(input as SaveAgentFileDto),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.createSkill, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.createSkill,
      () => store.createSkill(input as CreateAgentSkillDto),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.renameSkill, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.renameSkill,
      () => {
        const request = input as { skillId: string; name: string }
        return store.renameSkill(request.skillId, request.name)
      },
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.deleteSkill, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.deleteSkill,
      () => store.deleteSkill((input as { skillId: string }).skillId),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.setSkillEnabled, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.setSkillEnabled,
      () => {
        const request = input as { skillId: string; enabled: boolean }
        return store.setSkillEnabled(request.skillId, request.enabled)
      },
      interactions
    )
  )
}
