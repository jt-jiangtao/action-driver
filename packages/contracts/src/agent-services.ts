import type {
  AgentGoalRequest,
  AppApprovalDecision,
  RecentTaskProjection,
  TaskProjection
} from './task-projection'
import type { SkillCapability, SkillExecutionEvent, SkillId, SkillInvocation } from './skill'

export interface AgentSessionRepository {
  getTask(taskId: string): TaskProjection | null
  subscribe(listener: (task: TaskProjection) => void): () => void
}

export interface AgentCommandService {
  submitGoal(request: AgentGoalRequest): Promise<TaskProjection>
  interrupt(taskId: string): Promise<void>
  continueTask(taskId: string): Promise<void>
  provideInput(taskId: string, value: unknown): Promise<void>
  decideAppApproval(taskId: string, requestId: string, decision: AppApprovalDecision): Promise<void>
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
