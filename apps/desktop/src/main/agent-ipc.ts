import { RuntimeRpcError, type RuntimeClient } from '@actiondriver/runtime-contracts'
import type { InteractionLogger } from '@actiondriver/observability'
import type { AgentIpcError, AgentIpcResponse } from '../shared/agent-ipc-contract'
import type { AgentControlSkillInput } from '../shared/agent-ipc-contract'
import { AGENT_IPC_CHANNELS } from '../shared/agent-ipc-contract'

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
  operation: () => Promise<T>,
  interactions?: InteractionLogger
): Promise<AgentIpcResponse<T>> {
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
    finish?.({
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
  interactions?: InteractionLogger,
  taskConfiguration?: AgentTaskConfiguration
): void {
  ipcMain.handle(AGENT_IPC_CHANNELS.submit, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.submit,
      async () => {
        const request = input as { goal: string }
        const systemPrompt = await taskConfiguration?.getSystemPrompt()
        return runtimeClient.request(
          'task.submit',
          systemPrompt === undefined ? request : { ...request, systemPrompt }
        )
      },
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.get, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.get,
      () => runtimeClient.request('task.get', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.interrupt, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.interrupt,
      () => runtimeClient.request('task.interrupt', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.continue, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.continue,
      () => runtimeClient.request('task.continue', input as { taskId: string }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.provideInput, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.provideInput,
      () =>
        runtimeClient.request('task.provide-input', input as { taskId: string; value: unknown }),
      interactions
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.controlSkill, (_event, input) =>
    asIpcResponse(
      AGENT_IPC_CHANNELS.controlSkill,
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
