export type ComputerControlState = 'running' | 'paused' | 'taken-over'

export class ComputerUseControlGate {
  private readonly states = new Map<string, ComputerControlState>()

  set(taskId: string, state: ComputerControlState): void {
    if (state === 'running') this.states.delete(taskId)
    else this.states.set(taskId, state)
  }

  get(taskId: string): ComputerControlState { return this.states.get(taskId) ?? 'running' }

  assertRunning(taskId: string): void {
    const state = this.get(taskId)
    if (state === 'paused') throw new Error('COMPUTER_USE_PAUSED: resume the task before acting')
    if (state === 'taken-over') throw new Error('COMPUTER_USE_TAKEN_OVER: user controls the desktop')
  }
}
