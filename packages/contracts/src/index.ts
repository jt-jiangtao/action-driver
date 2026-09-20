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

export interface TaskProjection {
  id: string
  title: string
  status: SkillExecutionState
  messages: AgentMessageProjection[]
  steps: ExecutionStepProjection[]
  browser: BrowserSkillProjection | null
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
  submitGoal(goal: string): Promise<TaskProjection>
  interrupt(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
}

export interface SkillGateway {
  invoke(invocation: SkillInvocation): Promise<SkillExecutionEvent>
  pause(invocationId: string): Promise<SkillExecutionEvent>
  resume(invocationId: string): Promise<SkillExecutionEvent>
  takeOver(invocationId: string): Promise<SkillExecutionEvent>
  getCapability<TSkillId extends SkillId>(skillId: TSkillId): SkillCapability<TSkillId>
  subscribe(listener: (event: SkillExecutionEvent) => void): () => void
}

export const SERVICE_TYPES = {
  agentCommandService: Symbol.for('actiondriver.agent-command-service'),
  agentSessionRepository: Symbol.for('actiondriver.agent-session-repository'),
  skillGateway: Symbol.for('actiondriver.skill-gateway')
} as const

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
