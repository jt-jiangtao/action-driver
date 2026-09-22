import type { TaskProjection } from '@actiondriver/contracts'

export interface RecentTaskSummary {
  id: string
  title: string
  state: 'default' | 'loading'
}

export interface TaskCatalog {
  listRecentTasks(): Promise<readonly RecentTaskSummary[]>
  getTask(taskId: string): Promise<TaskProjection | null>
}
