import type { SkillExecutionState } from '@action-driver/contracts'
import type { AgentControlApi } from '../agent-session/runtime-agent-http-api'
import type { RecentTaskSummary, TaskCatalog } from '../../models/task-catalog'

export class DesktopTaskCatalog implements TaskCatalog {
  constructor(private readonly api: AgentControlApi) {}

  async listRecentTasks(): Promise<readonly RecentTaskSummary[]> {
    const tasks = this.api.listSessions
      ? (await this.api.listSessions(false, '', null, 50)).items
      : await this.api.listTasks(50)
    return tasks.map((task) => ({
      id: task.id,
      sessionId: task.sessionId,
      title: task.title,
      state: toRecentTaskState(task.status),
      pinned: 'pinned' in task && typeof task.pinned === 'boolean' ? task.pinned : false
    }))
  }

  async listArchivedTasks(query: string, cursor?: string | null) {
    if (!this.api.listSessions) return { items: [], nextCursor: null }
    const page = await this.api.listSessions(true, query, cursor)
    return {
      items: page.items.map((task) => ({
        id: task.id,
        sessionId: task.sessionId,
        title: task.title,
        state: toRecentTaskState(task.status),
        pinned: task.pinned,
        archivedAt: task.archivedAt
      })),
      nextCursor: page.nextCursor
    }
  }

  async setPinned(sessionId: string, pinned: boolean): Promise<void> {
    if (!this.api.setSessionPinned) throw new Error('置顶功能暂不可用')
    await this.api.setSessionPinned(sessionId, pinned)
  }

  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    if (!this.api.setSessionArchived) throw new Error('归档功能暂不可用')
    await this.api.setSessionArchived(sessionId, archived)
  }

  getTask(taskId: string) {
    return this.api.get(taskId)
  }
}

function toRecentTaskState(status: SkillExecutionState): RecentTaskSummary['state'] {
  return status === 'queued' || status === 'running' ? 'loading' : 'default'
}
