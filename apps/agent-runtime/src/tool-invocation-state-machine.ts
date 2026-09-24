import type { PersistedToolInvocation } from './ports'

export type ToolInvocationState = PersistedToolInvocation['status']

const ALLOWED_TRANSITIONS: Record<ToolInvocationState, readonly ToolInvocationState[]> = {
  proposed: ['queued', 'failed', 'cancelled'],
  waiting_approval: [],
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'unknown'],
  completed: [],
  failed: [],
  cancelled: [],
  unknown: []
}

export class ToolInvocationStateMachine {
  private currentState: ToolInvocationState = 'proposed'

  get state(): ToolInvocationState {
    return this.currentState
  }

  transition(next: ToolInvocationState): ToolInvocationState {
    if (!ALLOWED_TRANSITIONS[this.currentState].includes(next)) {
      throw new Error(`INVALID_TOOL_TRANSITION: ${this.currentState} -> ${next}`)
    }
    this.currentState = next
    return next
  }
}
