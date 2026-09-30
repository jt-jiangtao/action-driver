import type { ToolExecutionContext } from '@action-driver/runtime-contracts'
import type { TaskRepository } from '../ports'
import { ensureSessionWorkspace } from './session-workspace'

export class ExecutionContextUnavailableError extends Error {
  readonly code = 'EXECUTION_CONTEXT_UNAVAILABLE'

  constructor(message = 'EXECUTION_CONTEXT_UNAVAILABLE: no persisted task owns this execution') {
    super(message)
    this.name = 'ExecutionContextUnavailableError'
  }
}

/**
 * Builds the execution context from persisted state so scripts never trust a
 * session or workspace identifier supplied by the model.
 */
export class SessionExecutionContextResolver {
  constructor(
    private readonly options: {
      tasks: Pick<TaskRepository, 'get'>
      workspaceRoot: string
    }
  ) {}

  async resolve(taskId: string): Promise<ToolExecutionContext> {
    const task = await this.options.tasks.get(taskId)
    if (!task) throw new ExecutionContextUnavailableError()
    return {
      taskId: task.id,
      sessionId: task.sessionId,
      workspace: await ensureSessionWorkspace(this.options.workspaceRoot, task.sessionId)
    }
  }
}
