import { RuntimeRpcError, type RuntimeClient } from '@actiondriver/runtime-contracts'
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

async function asIpcResponse<T>(operation: () => Promise<T>): Promise<AgentIpcResponse<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: serializeError(error) }
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
  runtimeClient: AgentRuntimeClient
): void {
  ipcMain.handle(AGENT_IPC_CHANNELS.submit, (_event, input) =>
    asIpcResponse(() => runtimeClient.request('task.submit', input as { goal: string }))
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.get, (_event, input) =>
    asIpcResponse(() => runtimeClient.request('task.get', input as { taskId: string }))
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.interrupt, (_event, input) =>
    asIpcResponse(() => runtimeClient.request('task.interrupt', input as { taskId: string }))
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.continue, (_event, input) =>
    asIpcResponse(() => runtimeClient.request('task.continue', input as { taskId: string }))
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.provideInput, (_event, input) =>
    asIpcResponse(() =>
      runtimeClient.request('task.provide-input', input as { taskId: string; value: unknown })
    )
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.controlSkill, (_event, input) =>
    asIpcResponse(() => runtimeClient.request('skill.control', input as AgentControlSkillInput))
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.subscribe, (event, rawInput) => {
    const input = rawInput as {
      subscriptionId: string
      taskId: string
      afterCursor: number
    }
    return asIpcResponse(async () => {
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
    })
  })
}
