import type { SkillExecutionState } from '@actiondriver/contracts'
import type { AgentControlApi } from './runtime-agent-http-api'
import type { RecentTaskSummary, TaskCatalog } from '../models/task-catalog'

export class DesktopTaskCatalog implements TaskCatalog {
  constructor(private readonly api: AgentControlApi) {}

  async listRecentTasks(): Promise<readonly RecentTaskSummary[]> {
    const tasks = await this.api.listTasks(50)
    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      state: toRecentTaskState(task.status)
    }))
  }

  getTask(taskId: string) {
    return this.api.get(taskId)
  }
}

function toRecentTaskState(status: SkillExecutionState): RecentTaskSummary['state'] {
  return status === 'queued' || status === 'running' ? 'loading' : 'default'
}
