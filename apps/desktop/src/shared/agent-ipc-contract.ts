import type { TaskProjection } from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import type { RuntimeRpcErrorCode } from '@actiondriver/runtime-contracts'

export const AGENT_IPC_CHANNELS = {
  submit: 'actiondriver:agent:submit',
  get: 'actiondriver:agent:get',
  interrupt: 'actiondriver:agent:interrupt',
  continue: 'actiondriver:agent:continue',
  provideInput: 'actiondriver:agent:provide-input',
  subscribe: 'actiondriver:agent:subscribe',
  event: 'actiondriver:agent:event'
} as const

export type AgentSubmitResult = { taskId: string }
export type AgentGetResult = { task: TaskProjection | null }
export type AgentAcceptedResult = { accepted: true }
export type AgentSubscriptionResult = { cursor: number }
export type AgentEventMessage = { subscriptionId: string; event: RuntimeEvent }
export type AgentIpcError = {
  code: RuntimeRpcErrorCode | 'UNKNOWN'
  message: string
  details?: unknown
}
export type AgentIpcResponse<T> = { ok: true; value: T } | { ok: false; error: AgentIpcError }
