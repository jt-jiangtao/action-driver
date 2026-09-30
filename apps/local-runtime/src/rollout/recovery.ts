import type { PersistedStreamRequest, RuntimeEventRecord } from '@action-driver/agent-runtime/ports'
import { deriveRolloutEvents } from './event-bridge'
import type { RolloutLineDraft } from './model'
import type { RolloutStoreContext } from './store-context'

export class RolloutRecoveryOperations {
  constructor(private readonly context: RolloutStoreContext) {}

  /**
   * Idempotently ends requests that were still running when the process exited.
   * Only terminal records are appended; nothing already written is rewritten and
   * no tool is executed again.
   */
  async recoverInterruptedRequests(code: string): Promise<RuntimeEventRecord[]> {
    const recovered: RuntimeEventRecord[] = []
    for (const request of this.context.projection.listStreamRequests()) {
      if (request.status !== 'running') continue
      const runtime = this.context.ensureRuntime(request.sessionId)
      if (!runtime) continue
      const turn = runtime.state.turns.find((candidate) => candidate.turnId === request.taskId)
      if (!turn) continue
      const at = this.context.now()
      const drafts: RolloutLineDraft[] = []
      for (const tool of turn.tools.values()) {
        if (!['proposed', 'waiting_approval', 'queued', 'running'].includes(tool.status)) continue
        drafts.push({
          t: 'tool',
          ts: at,
          turnId: turn.turnId,
          blockId: tool.blockId,
          callId: tool.callId,
          itemIndex: tool.itemIndex,
          toolId: tool.toolId,
          modelName: tool.modelName,
          status: 'unknown',
          errorSummary: 'Tool outcome is unknown after Runtime restart'
        })
      }
      drafts.push({
        t: 'turn_end',
        ts: at,
        turnId: turn.turnId,
        status: 'failed',
        error: { code, message: 'Runtime exited before this task completed', retryable: false }
      })
      drafts.push({
        t: 'event',
        ts: at,
        turnId: turn.turnId,
        type: 'runtime.interrupted',
        payload: {
          error: { code, message: 'Runtime exited before this task completed', retryable: false }
        }
      })
      this.context.appendLines(runtime, drafts)
      const updated: PersistedStreamRequest = { ...request, status: 'failed', updatedAt: at }
      this.context.requests.set(request.requestId, updated)
      this.context.projection.saveStreamRequest(updated)
      recovered.push(...deriveRolloutEvents(runtime.lines, updated))
    }
    return recovered
  }
}
