import type { RuntimeTaskRecord } from './ports'
import type { SqliteRuntimeRepositories } from './repositories'
import type { ResilientSqliteSaver } from './sqlite-checkpointer'

export type ReconciliationResult = {
  scanned: number
  projected: number
  skipped: number
}

export class ProjectionService {
  constructor(
    private readonly checkpointer: ResilientSqliteSaver,
    private readonly repositories: SqliteRuntimeRepositories
  ) {}

  async reconcile(): Promise<ReconciliationResult> {
    const threadIds = this.checkpointer.listThreadIds()
    let projected = 0
    let skipped = 0

    for (const threadId of threadIds) {
      const applied = await this.projectLatest(threadId)
      if (applied) projected += 1
      else skipped += 1
    }

    return { scanned: threadIds.length, projected, skipped }
  }

  async projectLatest(threadId: string): Promise<boolean> {
    const tuple = await this.checkpointer.getTuple({ configurable: { thread_id: threadId } })
    if (!tuple) return false

    const checkpointId = tuple.config.configurable?.checkpoint_id ?? tuple.checkpoint.id
    const values = tuple.checkpoint.channel_values as Record<string, unknown>
    const task = this.taskFromCheckpoint(values, checkpointId, tuple.checkpoint.ts)

    return this.repositories.projectCheckpoint(task, {
      taskId: task.id,
      threadId: task.threadId,
      checkpointId,
      eventKey: 'checkpoint.projected',
      type: 'task.projected',
      payload: { status: task.status },
      occurredAt: task.updatedAt
    })
  }

  private taskFromCheckpoint(
    values: Record<string, unknown>,
    checkpointId: string,
    checkpointTimestamp: string
  ): RuntimeTaskRecord {
    const taskId = requiredString(values.taskId, 'taskId')
    const threadId = requiredString(values.threadId, 'threadId')
    const goal = requiredString(values.goal, 'goal')
    const status = requiredString(values.status, 'status')
    const model = requiredModelRef(values.model)

    return {
      id: taskId,
      threadId,
      sessionId: threadId,
      goal,
      model,
      status,
      error: values.error ?? null,
      lastCheckpointId: checkpointId,
      createdAt: checkpointTimestamp,
      updatedAt: checkpointTimestamp
    }
  }
}

function requiredModelRef(value: unknown): RuntimeTaskRecord['model'] {
  if (!value || typeof value !== 'object') {
    throw new Error('Checkpoint projection requires a model reference')
  }
  const model = value as Record<string, unknown>
  return {
    connectionId: requiredString(model.connectionId, 'model.connectionId'),
    modelId: requiredString(model.modelId, 'model.modelId')
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Checkpoint projection requires a non-empty ${field}`)
  }
  return value
}
