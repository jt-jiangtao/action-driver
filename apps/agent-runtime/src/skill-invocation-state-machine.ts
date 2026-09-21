export type SkillInvocationState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_user'
  | 'takeover'
  | 'completed'
  | 'failed'
  | 'cancelled'

const ALLOWED_TRANSITIONS: Record<SkillInvocationState, readonly SkillInvocationState[]> = {
  queued: ['running', 'cancelled'],
  running: ['paused', 'waiting_user', 'takeover', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'takeover', 'cancelled'],
  waiting_user: ['running', 'takeover', 'cancelled'],
  takeover: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
}

export class SkillInvocationStateMachine {
  private currentState: SkillInvocationState = 'queued'

  get state(): SkillInvocationState {
    return this.currentState
  }

  transition(next: SkillInvocationState): SkillInvocationState {
    if (!ALLOWED_TRANSITIONS[this.currentState].includes(next)) {
      throw new Error(`INVALID_SKILL_TRANSITION: ${this.currentState} -> ${next}`)
    }
    this.currentState = next
    return this.currentState
  }
}
