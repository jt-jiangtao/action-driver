import type { TaskProjection } from '@actiondriver/contracts'

export interface RecentTaskSummary {
  id: string
  title: string
  state: 'default' | 'loading'
}

export interface TaskCatalog {
  listRecentTasks(): readonly RecentTaskSummary[]
  getTask(taskId: string): TaskProjection | null
}
