import type {
  BrowserSessionActor,
  BrowserSessionCommand,
  BrowserSessionControl,
  BrowserSessionSnapshot,
  BrowserSurface,
  createBrowserDesktopSessionController
} from '@action-driver/browser-desktop'

type Controller = ReturnType<typeof createBrowserDesktopSessionController>

/** Keeps Action-Driver task ownership out of the reusable browser-desktop package. */
export function createTaskBrowserBinding(controller: Controller) {
  const sessions = new Map<string, Map<BrowserSurface, string>>()
  const opening = new Map<string, Map<BrowserSurface, Promise<BrowserSessionSnapshot>>>()
  const closing = new Map<string, Promise<void>>()
  const assertOwner = (taskId: string, sessionId: string) => {
    if (![...(sessions.get(taskId)?.values() ?? [])].includes(sessionId))
      throw new Error('BROWSER_TASK_MISMATCH')
  }
  return {
    taskForSession(sessionId: string): string | null {
      for (const [taskId, owned] of sessions)
        if ([...owned.values()].includes(sessionId)) return taskId
      return null
    },
    async open(taskId: string, surface: BrowserSurface): Promise<BrowserSessionSnapshot> {
      if (!taskId) throw new Error('BROWSER_TASK_REQUIRED')
      if (closing.has(taskId)) throw new Error('BROWSER_TASK_CLOSING')
      if (sessions.get(taskId)?.has(surface)) throw new Error('BROWSER_TASK_SESSION_EXISTS')
      const pending = opening.get(taskId)?.get(surface)
      if (pending) return pending
      const operation = controller.open(surface).then((snapshot) => {
        const owned = sessions.get(taskId) ?? new Map<BrowserSurface, string>()
        owned.set(surface, snapshot.sessionId)
        sessions.set(taskId, owned)
        return snapshot
      }).finally(() => {
        const inFlight = opening.get(taskId)
        inFlight?.delete(surface)
        if (inFlight?.size === 0) opening.delete(taskId)
      })
      const inFlight = opening.get(taskId) ?? new Map<BrowserSurface, Promise<BrowserSessionSnapshot>>()
      inFlight.set(surface, operation)
      opening.set(taskId, inFlight)
      return operation
    },
    async execute(taskId: string, sessionId: string, tabId: string,
      command: BrowserSessionCommand, actor: BrowserSessionActor): Promise<unknown> {
      assertOwner(taskId, sessionId)
      return controller.execute(sessionId, tabId, command, actor)
    },
    transition(taskId: string, sessionId: string,
      control: BrowserSessionControl): Promise<BrowserSessionSnapshot> {
      assertOwner(taskId, sessionId)
      return controller.transition(sessionId, control)
    },
    async snapshot(taskId: string, surface?: BrowserSurface): Promise<BrowserSessionSnapshot | null> {
      const owned = sessions.get(taskId)
      const sessionId = surface ? owned?.get(surface)
        : owned?.get('embedded') ?? owned?.get('external-chrome')
      return sessionId ? controller.snapshot(sessionId) : null
    },
    async snapshots(taskId: string): Promise<BrowserSessionSnapshot[]> {
      const owned = sessions.get(taskId)
      return Promise.all([...(owned?.values() ?? [])].map((id) => controller.snapshot(id)))
    },
    async close(taskId: string, sessionId: string): Promise<void> {
      assertOwner(taskId, sessionId)
      const owned = sessions.get(taskId)!
      for (const [surface, id] of owned) if (id === sessionId) owned.delete(surface)
      if (owned.size === 0) sessions.delete(taskId)
      await controller.close(sessionId)
    },
    closeTask(taskId: string): Promise<void> {
      if (!taskId) throw new Error('BROWSER_TASK_REQUIRED')
      const existing = closing.get(taskId)
      if (existing) return existing
      const operation = (async () => {
        await Promise.allSettled([...(opening.get(taskId)?.values() ?? [])])
        const owned = sessions.get(taskId)
        sessions.delete(taskId)
        await Promise.all([...(owned?.values() ?? [])].map((id) => controller.close(id)))
      })().finally(() => { closing.delete(taskId) })
      closing.set(taskId, operation)
      return operation
    }
  }
}
