import { RuntimeRpcError, type RuntimeClient } from '@actiondriver/runtime-contracts'
import type { AgentGoalRequest, ModelLogQuery } from '@actiondriver/contracts'
import type { InteractionLogRecorder } from '@actiondriver/observability'
import type { AgentIpcError, AgentIpcResponse } from '../shared/agent-ipc-contract'
import type { AgentControlSkillInput } from '../shared/agent-ipc-contract'
import { AGENT_IPC_CHANNELS } from '../shared/agent-ipc-contract'
import { startIpcInteraction } from './logging'

type AgentIpcEvent = {
  sender: { send(channel: string, payload: unknown): void }
}

type AgentIpcHandler = (event: AgentIpcEvent, input: unknown) => unknown

export interface AgentIpcMain {
  handle(channel: string, handler: AgentIpcHandler): void
}

export type AgentRuntimeClient = Pick<RuntimeClient, 'request' | 'subscribeEvents'>

export interface AgentTaskConfiguration {
  getSystemPrompt(): Promise<string>
}

async function asIpcResponse<T>(
  channel: string,
  input: unknown,
  operation: () => Promise<T>,
  interactions?: InteractionLogRecorder
): Promise<AgentIpcResponse<T>> {
  const finish = await startIpcInteraction(interactions, channel, input)
  try {
    const value = await operation()
    await finish?.({ outcome: 'ok', response: { kind: 'json', value } })
    return { ok: true, value }
  } catch (error) {
    const serialized = serializeError(error)
    await finish?.({
      outcome: 'error',
      error: { code: serialized.code, message: serialized.message }
    })
    return { ok: false, error: serialized }
  }
}

function serializeError(error: unknown): AgentIpcError {
  if (error instanceof RuntimeRpcError) {
    return error.details === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, details: error.details }
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error)
  }
}

export function registerAgentIpcHandlers(
  ipcMain: AgentIpcMain,
  runtimeClient: AgentRuntimeClient,
  interactions?: InteractionLogRecorder,
  taskConfiguration?: AgentTaskConfiguration
): void {
  ipcMain.handle(AGENT_IPC_CHANNELS.submit, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.submit,
      input,
      async () => {
        const request = input as AgentGoalRequest
        const systemPrompt = taskConfiguration
          ? await taskConfiguration.getSystemPrompt()
          : undefined
        return runtimeClient.request('task.submit', {
          ...request,
          ...(systemPrompt === undefined ? {} : { systemPrompt }),
          skills: []
        })
      },
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.get, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.get,
      input,
      () => runtimeClient.request('task.get', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.list, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.list,
      input,
      () => runtimeClient.request('task.list', input as { limit?: number }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.modelLogList, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.modelLogList,
      input,
      () => runtimeClient.request('model-log.list', input as ModelLogQuery),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.modelLogGet, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.modelLogGet,
      input,
      () => runtimeClient.request('model-log.get', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.interrupt, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.interrupt,
      input,
      () => runtimeClient.request('task.interrupt', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.continue, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.continue,
      input,
      () => runtimeClient.request('task.continue', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.provideInput, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.provideInput,
      input,
      () =>
        runtimeClient.request('task.provide-input', input as { taskId: string; value: unknown }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.controlSkill, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.controlSkill,
      input,
      () => runtimeClient.request('skill.control', input as AgentControlSkillInput),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.subscribe, (event, rawInput) => {
    const input = rawInput as {
      subscriptionId: string
      taskId: string
      afterCursor: number
    }
    return asIpcResponse(
      AGENT_IPC_CHANNELS.subscribe,
      rawInput,
      async () => {
        const subscription = await runtimeClient.subscribeEvents(
          input.taskId,
          input.afterCursor,
          (runtimeEvent) =>
            event.sender.send(AGENT_IPC_CHANNELS.event, {
              subscriptionId: input.subscriptionId,
              event: runtimeEvent
            })
        )
        return { cursor: subscription.cursor }
      },
      interactions
    )
  })
}
