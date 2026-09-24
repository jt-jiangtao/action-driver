export type SkillExecutionState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting-user'
  | 'taken-over'
  | 'succeeded'
  | 'failed'

export const SKILL_IDS = {
  browser: 'browser-use',
  computer: 'computer-use'
} as const

export type SkillId = (typeof SKILL_IDS)[keyof typeof SKILL_IDS]

export interface SkillExecutionEvent {
  id: string
  invocationId: string
  skillId: string
  state: SkillExecutionState
  occurredAt: string
}

export interface BrowserTargetProjection {
  label: string
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserSkillProjection {
  title: string
  url: string
  status: SkillExecutionState
  target: BrowserTargetProjection | null
}

export interface AgentMessageProjection {
  id: string
  role: 'user' | 'agent'
  content: string
}

export interface ExecutionStepProjection {
  id: string
  title: string
  detail: string
  state: 'success' | 'current' | 'waiting' | 'failed'
}

export interface ToolInvocationProjection {
  callId: string
  toolId: string
  modelName: string
  summary: string
  title?: string
  argumentsHash: string
  activityId?: string | null
  rawInput?: string
  rawOutput?: string
  rawOutputTruncated?: boolean
  durationMs?: number
  resultSummary?: string
  errorSummary?: string
  status:
    | 'proposed'
    | 'waiting_approval'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'unknown'
}

export interface ActivityTextProjection {
  id: string
  kind: 'text'
  content: string
  phase?: 'pending' | 'process' | 'final' | undefined
}

export interface ActivityToolProjection {
  id: string
  kind: 'tool'
  callId: string
}

export interface ActivityProjection {
  activityId: string
  title: string
  titleRevision: number
  status: 'running' | 'completed'
  items: Array<ActivityTextProjection | ActivityToolProjection>
}

export type TaskTimelineProjectionItem =
  | { id: string; kind: 'activity'; activityId: string }
  | { id: string; kind: 'tool'; callId: string }
  | {
      id: string
      kind: 'text'
      content: string
      phase?: 'pending' | 'process' | 'final' | undefined
    }

export interface PriorActivityTurnProjection {
  taskId: string
  userMessageId: string
  durationMs?: number
  tools: ToolInvocationProjection[]
  activities: ActivityProjection[]
  activityTimeline: TaskTimelineProjectionItem[]
}

export interface TaskProjection {
  id: string
  sessionId: string
  title: string
  status: SkillExecutionState
  model: ModelRef
  messages: AgentMessageProjection[]
  steps: ExecutionStepProjection[]
  tools?: ToolInvocationProjection[]
  activities?: ActivityProjection[]
  activityTimeline?: TaskTimelineProjectionItem[]
  activityStartedAt?: string
  activityDurationMs?: number | undefined
  preparingToolName?: string
  streamRequestId?: string
  streamResponseId?: string
  priorActivityTurns?: PriorActivityTurnProjection[]
  streamCursor?: number
  streamSequence?: number
  browser: BrowserSkillProjection | null
}

export type ModelRef = {
  connectionId: string
  modelId: string
}

export type AgentGoalRequest =
  | { goal: string; model: ModelRef; sessionId?: never }
  | { goal: string; sessionId: string; model?: never }

export type RecentTaskProjection = {
  id: string
  sessionId: string
  title: string
  status: SkillExecutionState
  model: ModelRef
  createdAt: string
  updatedAt: string
}

interface BaseSkillInvocation<TSkillId extends SkillId, TInput> {
  id: string
  taskId: string
  skillId: TSkillId
  input: TInput
}

export type BrowserSkillInput =
  | { action: 'open-url'; url: string }
  | { action: 'click'; nodeHandle: string }
  | { action: 'scroll'; deltaX: number; deltaY: number }
  | { action: 'type'; nodeHandle: string; text: string }

export type ComputerUseSkillInput =
  | { action: 'activate-app'; bundleId: string }
  | { action: 'click'; x: number; y: number }
  | { action: 'type'; text: string }

export type BrowserSkillInvocation = BaseSkillInvocation<
  typeof SKILL_IDS.browser,
  BrowserSkillInput
>
export type ComputerUseSkillInvocation = BaseSkillInvocation<
  typeof SKILL_IDS.computer,
  ComputerUseSkillInput
>
export type SkillInvocation = BrowserSkillInvocation | ComputerUseSkillInvocation

export type SkillControlCommand = 'pause' | 'resume' | 'take-over'

export interface SkillCapability<TSkillId extends SkillId> {
  readonly skillId: TSkillId
  invoke(invocation: Extract<SkillInvocation, { skillId: TSkillId }>): Promise<SkillExecutionEvent>
  transition(invocationId: string, command: SkillControlCommand): Promise<SkillExecutionEvent>
}

export interface AgentSessionRepository {
  getTask(taskId: string): TaskProjection | null
  subscribe(listener: (task: TaskProjection) => void): () => void
}

export interface AgentCommandService {
  submitGoal(request: AgentGoalRequest): Promise<TaskProjection>
  interrupt(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
}

export interface TaskQueryService {
  listRecentTasks(): Promise<readonly RecentTaskProjection[]>
  getTask(taskId: string): Promise<TaskProjection | null>
}

export type AgentServiceErrorCode =
  | 'unavailable'
  | 'incompatible-runtime'
  | 'timeout'
  | 'invalid-response'
  | 'runtime-error'

export class AgentServiceError extends Error {
  constructor(
    readonly code: AgentServiceErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'AgentServiceError'
  }
}

export interface SkillGateway {
  invoke(invocation: SkillInvocation): Promise<SkillExecutionEvent>
  pause(invocationId: string): Promise<SkillExecutionEvent>
  resume(invocationId: string): Promise<SkillExecutionEvent>
  takeOver(invocationId: string): Promise<SkillExecutionEvent>
  getCapability<TSkillId extends SkillId>(skillId: TSkillId): SkillCapability<TSkillId>
  subscribe(listener: (event: SkillExecutionEvent) => void): () => void
}

export function isSerializableContract(value: unknown): boolean {
  const seen = new WeakSet<object>()

  const visit = (candidate: unknown): boolean => {
    if (candidate === null) return true
    if (['string', 'number', 'boolean'].includes(typeof candidate)) return true
    if (
      typeof candidate === 'undefined' ||
      typeof candidate === 'function' ||
      typeof candidate === 'symbol'
    ) {
      return false
    }
    if (typeof candidate !== 'object') return false
    if (seen.has(candidate)) return false
    seen.add(candidate)
    if (Array.isArray(candidate)) return candidate.every(visit)
    if (Object.getPrototypeOf(candidate) !== Object.prototype) return false
    return Object.values(candidate).every(visit)
  }

  return visit(value)
}
