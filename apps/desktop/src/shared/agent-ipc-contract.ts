import type {
  ModelLogQuery,
  ModelLogSessionProjection,
  RecentTaskProjection,
  SkillControlCommand,
  SkillExecutionEvent,
  TaskProjection
} from '@actiondriver/contracts'
import type { RuntimeEvent } from '@actiondriver/runtime-contracts'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import type { RuntimeRpcErrorCode } from '@actiondriver/runtime-contracts'

export const AGENT_IPC_CHANNELS = {
  submit: 'actiondriver:agent:submit',
  cancel: 'actiondriver:agent:cancel',
  get: 'actiondriver:agent:get',
  list: 'actiondriver:agent:list',
  modelLogList: 'actiondriver:agent:model-log-list',
  modelLogGet: 'actiondriver:agent:model-log-get',
  interrupt: 'actiondriver:agent:interrupt',
  continue: 'actiondriver:agent:continue',
  provideInput: 'actiondriver:agent:provide-input',
  controlSkill: 'actiondriver:agent:control-skill',
  subscribe: 'actiondriver:agent:subscribe',
  event: 'actiondriver:agent:event',
  streamEvent: 'actiondriver:agent:stream-event'
} as const

export type AgentSubmitResult = Extract<StreamServerEvent, { type: 'request.accepted' }>
export type AgentGetResult = { task: TaskProjection | null }
export type AgentListResult = { tasks: RecentTaskProjection[] }
export type AgentModelLogListInput = ModelLogQuery
export type AgentModelLogListResult = { sessions: ModelLogSessionProjection[] }
export type AgentModelLogGetResult = { session: ModelLogSessionProjection | null }
export type AgentAcceptedResult = { accepted: true }
export type AgentSubscriptionResult = { cursor: number }
export type AgentControlSkillResult = { event: SkillExecutionEvent }
export type AgentControlSkillInput = {
  invocationId: string
  command: SkillControlCommand
}
export type AgentEventMessage = { subscriptionId: string; event: RuntimeEvent }
export type AgentStreamEventMessage = StreamServerEvent
export type AgentIpcError = {
  code: RuntimeRpcErrorCode | 'UNKNOWN'
  message: string
  details?: unknown
}
export type AgentIpcResponse<T> = { ok: true; value: T } | { ok: false; error: AgentIpcError }
