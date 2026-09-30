import type { TaskProjection } from '@action-driver/contracts'
import type { RecentTaskSummary } from './task-catalog'

export function mergeSubmittedTask(
  current: readonly RecentTaskSummary[],
  projection: Pick<TaskProjection, 'id' | 'sessionId' | 'title' | 'status'>,
  previousTaskId?: string
): readonly RecentTaskSummary[] {
  const state = projection.status === 'running' || projection.status === 'queued' ? 'loading' : 'default'
  if (previousTaskId) {
    const existing = current.find((item) => item.sessionId === projection.sessionId)
    if (!existing) return current
    return current
      .filter((item) => item.id !== previousTaskId || item.sessionId === projection.sessionId)
      .map((item) => item.sessionId === projection.sessionId ? { ...item, id: projection.id, state } : item)
  }
  const submitted: RecentTaskSummary = {
    id: projection.id,
    sessionId: projection.sessionId,
    title: projection.title,
    state,
    pinned: false
  }
  const remaining = current.filter((item) => item.sessionId !== projection.sessionId && item.id !== projection.id)
  const firstUnpinned = remaining.findIndex((item) => !item.pinned)
  const index = firstUnpinned < 0 ? remaining.length : firstUnpinned
  return [...remaining.slice(0, index), submitted, ...remaining.slice(index)]
}
