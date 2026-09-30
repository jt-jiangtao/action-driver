import type { TaskProjection } from '@action-driver/contracts'

export interface RecentTaskSummary {
  id: string
  sessionId?: string
  title: string
  state: 'default' | 'loading'
  pinned?: boolean
  archivedAt?: string | null
}

export interface ArchivedTaskPage {
  items: readonly RecentTaskSummary[]
  nextCursor: string | null
}

export interface TaskCatalog {
  listRecentTasks(): Promise<readonly RecentTaskSummary[]>
  listArchivedTasks?(query: string, cursor?: string | null): Promise<ArchivedTaskPage>
  setPinned?(sessionId: string, pinned: boolean): Promise<void>
  setArchived?(sessionId: string, archived: boolean): Promise<void>
  getTask(taskId: string): Promise<TaskProjection | null>
}
