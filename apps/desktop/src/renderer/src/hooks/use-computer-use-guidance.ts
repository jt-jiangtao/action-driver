import { useEffect, useRef } from 'react'

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
    const api = window.productDesktop?.computerUse
    if (!api?.ensureGuidance) return
    void api.ensureGuidance().catch(() => undefined)
  }, [taskId, usesComputerUse])
}
