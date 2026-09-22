import type { InteractionLogRecorder } from '@actiondriver/observability'
import {
  AGENT_FILES_IPC_CHANNELS,
  type AgentFileErrorDto,
  type AgentFileIpcResponse,
  type CreateAgentSkillDto,
  type SaveAgentFileDto
} from '../shared/agent-files-contract'
import { AgentFileStoreError } from './agent-files/agent-file-store'
import type { AgentFileStore } from './agent-files/agent-file-store'
import { startIpcInteraction } from './logging'

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
  input: unknown,
  operation: () => Promise<T> | T,
  interactions?: InteractionLogRecorder
): Promise<AgentFileIpcResponse<T>> {
  const finish = await startIpcInteraction(interactions, channel, input)
  try {
    const value = await operation()
    await finish?.({ outcome: 'ok', response: { kind: 'json', value } })
    return { ok: true, value }
  } catch (error) {
    const serialized = serializeError(error)
    await finish?.({ outcome: 'error', error: serialized })
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
  input: unknown,
  operation: () => Promise<T> | T,
  interactions?: InteractionLogRecorder
): Promise<AgentFileIpcResponse<T>> {
  return respond(
    channel,
    input,
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
  interactions?: InteractionLogRecorder
): void {
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.getMainPrompt, (event) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.getMainPrompt,
      null,
      () => store.getMainPrompt(),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.resetMainPrompt, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.resetMainPrompt,
      input,
      () => store.resetMainPrompt((input as { expectedDigest: string }).expectedDigest),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.listSkills, (event) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.listSkills,
      null,
      () => store.listSkills(),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.getSkillTree, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.getSkillTree,
      input,
      () => store.getSkillTree((input as { skillId: string }).skillId),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.readFile, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.readFile,
      input,
      () => store.readFile((input as { path: string }).path),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.saveFile, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.saveFile,
      input,
      () => store.saveFile(input as SaveAgentFileDto),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.createSkill, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.createSkill,
      input,
      () => store.createSkill(input as CreateAgentSkillDto),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.renameSkill, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.renameSkill,
      input,
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
      input,
      () => store.deleteSkill((input as { skillId: string }).skillId),
      interactions
    )
  )
  ipcMain.handle(AGENT_FILES_IPC_CHANNELS.setSkillEnabled, (event, input) =>
    secureRespond(
      event,
      AGENT_FILES_IPC_CHANNELS.setSkillEnabled,
      input,
      () => {
        const request = input as { skillId: string; enabled: boolean }
        return store.setSkillEnabled(request.skillId, request.enabled)
      },
      interactions
    )
  )
}
