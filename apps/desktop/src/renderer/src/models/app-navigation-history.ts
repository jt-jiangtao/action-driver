import type { AppRoute } from './app-route'

export type AppNavigationHistory = {
  entries: AppRoute[]
  index: number
}

export function createAppNavigationHistory(route: AppRoute): AppNavigationHistory {
  return { entries: [route], index: 0 }
}

function sameRoute(left: AppRoute, right: AppRoute): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== 'task' || (right.kind === 'task' && left.taskId === right.taskId))
  )
}

export function navigateAppHistory(
  history: AppNavigationHistory,
  route: AppRoute
): AppNavigationHistory {
  if (sameRoute(history.entries[history.index]!, route)) return history
  return {
    entries: [...history.entries.slice(0, history.index + 1), route],
    index: history.index + 1
  }
}

export function travelAppHistory(
  history: AppNavigationHistory,
  delta: -1 | 1
): AppNavigationHistory {
  const index = history.index + delta
  return index < 0 || index >= history.entries.length ? history : { ...history, index }
}
