import type { TaskProjection } from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import type {
  AgentAcceptedResult,
  AgentEventMessage,
  AgentGetResult,
  AgentSubmitResult,
  AgentSubscriptionResult
} from '../shared/agent-ipc-contract'
import { AGENT_IPC_CHANNELS } from '../shared/agent-ipc-contract'

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
  subscribe(
    taskId: string,
    afterCursor: number,
    listener: (event: RuntimeEvent) => void
  ): Promise<() => void>
}

export interface DesktopApi {
  getEnvironment(): { platform: NodeJS.Platform; version: string }
  agent: AgentDesktopApi
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
      submit: (goal) =>
        ipc.invoke(AGENT_IPC_CHANNELS.submit, { goal }) as Promise<AgentSubmitResult>,
      async get(taskId) {
        const result = (await ipc.invoke(AGENT_IPC_CHANNELS.get, { taskId })) as AgentGetResult
        return result.task
      },
      async interrupt(taskId) {
        await (ipc.invoke(AGENT_IPC_CHANNELS.interrupt, { taskId }) as Promise<AgentAcceptedResult>)
      },
      async continue(taskId) {
        await (ipc.invoke(AGENT_IPC_CHANNELS.continue, { taskId }) as Promise<AgentAcceptedResult>)
      },
      async provideInput(taskId, value) {
        await (ipc.invoke(AGENT_IPC_CHANNELS.provideInput, {
          taskId,
          value
        }) as Promise<AgentAcceptedResult>)
      },
      async subscribe(taskId, afterCursor, listener) {
        const subscriptionId = subscriptionIdFactory()
        const handleEvent = (_event: unknown, payload: unknown) => {
          const message = payload as AgentEventMessage
          if (message.subscriptionId === subscriptionId) listener(message.event)
        }
        ipc.on(AGENT_IPC_CHANNELS.event, handleEvent)
        try {
          await (ipc.invoke(AGENT_IPC_CHANNELS.subscribe, {
            subscriptionId,
            taskId,
            afterCursor
          }) as Promise<AgentSubscriptionResult>)
        } catch (error) {
          ipc.off(AGENT_IPC_CHANNELS.event, handleEvent)
          throw error
        }
        return () => ipc.off(AGENT_IPC_CHANNELS.event, handleEvent)
      }
    }
  }
}
