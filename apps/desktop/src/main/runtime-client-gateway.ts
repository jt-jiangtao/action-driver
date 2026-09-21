import {
  RuntimeRpcError,
  type RuntimeCommandMap,
  type RuntimeEvent,
  type RuntimeEventSubscription
} from '@actiondriver/runtime-contracts'
import type { AgentRuntimeClient } from './agent-ipc'

type RequestOptions = { deadlineUnixMs?: number }

export class RuntimeClientGateway implements AgentRuntimeClient {
  private client: Promise<AgentRuntimeClient> | null = null

  attach(client: Promise<AgentRuntimeClient>): void {
    this.client = client
  }

  async request<TCommand extends keyof RuntimeCommandMap>(
    command: TCommand,
    input: RuntimeCommandMap[TCommand]['request'],
    options?: RequestOptions
  ): Promise<RuntimeCommandMap[TCommand]['response']> {
    const client = this.requireClient()
    return (await client).request(command, input, options)
  }

  async subscribeEvents(
    taskId: string,
    afterCursor: number,
    onEvent: (event: RuntimeEvent) => void,
    options?: RequestOptions
  ): Promise<RuntimeEventSubscription> {
    const client = this.requireClient()
    return (await client).subscribeEvents(taskId, afterCursor, onEvent, options)
  }

  private requireClient(): Promise<AgentRuntimeClient> {
    if (this.client) return this.client
    return Promise.reject(
      new RuntimeRpcError('HANDSHAKE_REQUIRED', 'Local Agent Runtime is not connected')
    )
  }
}
