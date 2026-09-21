import type { RuntimeClient } from '@actiondriver/runtime-contracts'
import { AGENT_IPC_CHANNELS } from '../shared/agent-ipc-contract'

type AgentIpcEvent = {
  sender: { send(channel: string, payload: unknown): void }
}

type AgentIpcHandler = (event: AgentIpcEvent, input: unknown) => unknown

export interface AgentIpcMain {
  handle(channel: string, handler: AgentIpcHandler): void
}

export function registerAgentIpcHandlers(
  ipcMain: AgentIpcMain,
  runtimeClient: Pick<RuntimeClient, 'request' | 'subscribeEvents'>
): void {
  ipcMain.handle(AGENT_IPC_CHANNELS.submit, (_event, input) =>
    runtimeClient.request('task.submit', input as { goal: string })
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.get, (_event, input) =>
    runtimeClient.request('task.get', input as { taskId: string })
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.interrupt, (_event, input) =>
    runtimeClient.request('task.interrupt', input as { taskId: string })
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.continue, (_event, input) =>
    runtimeClient.request('task.continue', input as { taskId: string })
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.provideInput, (_event, input) =>
    runtimeClient.request('task.provide-input', input as { taskId: string; value: unknown })
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.subscribe, async (event, rawInput) => {
    const input = rawInput as {
      subscriptionId: string
      taskId: string
      afterCursor: number
    }
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
}
