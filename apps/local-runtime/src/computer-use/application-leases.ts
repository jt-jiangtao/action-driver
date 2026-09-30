import { COMPUTER_USE_GUIDANCE_ERRORS } from '@action-driver/agent-runtime/tool-error-exposure'

type Owner = { sessionId: string; turns: Set<string> }

/** Trusted runtime ownership; app keys must be canonical bundle identifiers from helper policy. */
export class ApplicationLeases {
  private readonly owners = new Map<string, Owner>()
  private readonly turns = new Map<string, { sessionId: string; apps: Set<string> }>()

  acquire(app: string, context: { sessionId: string; taskId: string }): void {
    if (!app || !context.sessionId || !context.taskId)
      throw new Error('INVALID_REQUEST: lease identity missing')
    const turn = this.turns.get(context.taskId)
    if (turn && turn.sessionId !== context.sessionId)
      throw new Error('INVALID_REQUEST: task session mismatch')
    const owner = this.owners.get(app)
    if (owner && owner.sessionId !== context.sessionId)
      throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.appBusy)
    const held = owner ?? { sessionId: context.sessionId, turns: new Set<string>() }
    held.turns.add(context.taskId)
    this.owners.set(app, held)
    const owned = turn ?? { sessionId: context.sessionId, apps: new Set<string>() }
    owned.apps.add(app)
    this.turns.set(context.taskId, owned)
  }

  releaseTurn(taskId: string): void {
    const turn = this.turns.get(taskId)
    if (!turn) return
    for (const app of turn.apps) {
      const owner = this.owners.get(app)
      if (owner?.sessionId !== turn.sessionId) continue
      owner.turns.delete(taskId)
      if (!owner.turns.size) this.owners.delete(app)
    }
    this.turns.delete(taskId)
  }

  releaseSession(sessionId: string): void {
    for (const [taskId, turn] of this.turns) {
      if (turn.sessionId === sessionId) this.releaseTurn(taskId)
    }
  }
}
