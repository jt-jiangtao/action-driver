import { useEffect, useRef } from 'react'
import type { TaskProjection } from '@actiondriver/contracts'

export function taskUsesComputerUse(task: TaskProjection | null | undefined): boolean {
  return Boolean(task?.tools?.some((tool) => tool.toolId.startsWith('computer.')))
}

/**
 * Reports to Main the first time a task actually invokes Computer Use. Main owns the decision to
 * open the standalone authorization guidance only when the helper reports a missing permission,
 * while the renderer only knows that Computer Use has started.
 */
export function useComputerUseGuidance(taskId: string | null, usesComputerUse: boolean): void {
  const ensured = useRef(new Set<string>())
  useEffect(() => {
    if (!taskId || !usesComputerUse || ensured.current.has(taskId)) return
    ensured.current.add(taskId)
    const api = window.actionDriverDesktop?.computerUse
    if (!api?.ensureGuidance) return
    void api.ensureGuidance().catch(() => undefined)
  }, [taskId, usesComputerUse])
}
