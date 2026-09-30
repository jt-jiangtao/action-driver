import { Annotation } from '@langchain/langgraph'
import type { ModelRef } from '@action-driver/contracts'
import type { ProviderToolCall } from '@action-driver/model-connections'
import type { RuntimeMessage } from '../ports'

export type AgentGraphStatus =
  | 'submitted'
  | 'accepted'
  | 'planned'
  | 'skill-resolved'
  | 'skill-completed'
  | 'verified'
  | 'waiting-user'
  | 'completed'
  | 'failed'

export type AgentGraphRoute = 'finish' | 'awaitUser' | 'failed'
export type PlanRoute = 'tools' | 'skill'

export const MAX_TOOL_CALLS = 512
export const MAX_TOOL_ROUNDS = 512
export const GRAPH_RECURSION_LIMIT = MAX_TOOL_ROUNDS * 2 + 16

const replace = <T>(_current: T, update: T): T => update

export const AgentState = Annotation.Root({
  taskId: Annotation<string>(),
  sessionId: Annotation<string>(),
  threadId: Annotation<string>(),
  goal: Annotation<string>(),
  model: Annotation<ModelRef>(),
  systemPrompt: Annotation<string>({ reducer: replace, default: () => '' }),
  messages: Annotation<RuntimeMessage[]>({ reducer: replace, default: () => [] }),
  modelMessages: Annotation<RuntimeMessage[]>({ reducer: replace, default: () => [] }),
  toolGrants: Annotation<string[]>({ reducer: replace, default: () => [] }),
  toolRound: Annotation<number>({ reducer: replace, default: () => 0 }),
  toolCallCount: Annotation<number>({ reducer: replace, default: () => 0 }),
  activeActivityId: Annotation<string | null>({ reducer: replace, default: () => null }),
  activityTitleRevision: Annotation<number>({ reducer: replace, default: () => 0 }),
  activityCapturesProgress: Annotation<boolean>({ reducer: replace, default: () => false }),
  activityToolNames: Annotation<string[]>({ reducer: replace, default: () => [] }),
  activityIssueCount: Annotation<number>({ reducer: replace, default: () => 0 }),
  pendingToolCalls: Annotation<ProviderToolCall[]>({ reducer: replace, default: () => [] }),
  planRoute: Annotation<PlanRoute>({ reducer: replace, default: () => 'skill' }),
  skills: Annotation<Array<{ skillId: string; description: string }>>({
    reducer: replace,
    default: () => []
  }),
  status: Annotation<AgentGraphStatus>(),
  requestedSkillId: Annotation<string | null>({ reducer: replace, default: () => null }),
  resolvedProviderId: Annotation<string | null>({ reducer: replace, default: () => null }),
  providerVersion: Annotation<string | null>({ reducer: replace, default: () => null }),
  skillInput: Annotation<unknown>({ reducer: replace, default: () => null }),
  output: Annotation<unknown>({ reducer: replace, default: () => null }),
  error: Annotation<string | null>({ reducer: replace, default: () => null }),
  route: Annotation<AgentGraphRoute>({ reducer: replace, default: () => 'finish' }),
  trace: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  })
})
