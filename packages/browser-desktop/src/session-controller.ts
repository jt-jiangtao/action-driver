import { randomUUID } from 'node:crypto'
import type {
  BrowserDesktopHostSession,
  BrowserSessionActor,
  BrowserSessionCommand,
  BrowserSessionControl,
  BrowserSessionSnapshot,
  BrowserSessionStatus,
  BrowserSurface
} from './session-contract.js'

interface ManagedSession {
  host: BrowserDesktopHostSession
  snapshot: BrowserSessionSnapshot
  queue: Promise<unknown>
  closed: boolean
}

export interface BrowserDesktopSessionControllerOptions {
  createHost(surface: BrowserSurface, sessionId: string): Promise<BrowserDesktopHostSession>
}

/** A host-neutral session boundary; task ownership stays in the application. */
export function createBrowserDesktopSessionController(options: BrowserDesktopSessionControllerOptions) {
  const sessions = new Map<string, ManagedSession>()
  const listeners = new Set<(snapshot: BrowserSessionSnapshot) => void>()
  const publish = (snapshot: BrowserSessionSnapshot) => {
    const copy = structuredClone(snapshot)
    for (const listener of listeners) listener(copy)
  }
  const get = (sessionId: string) => {
    const session = sessions.get(sessionId)
    if (!session || session.closed) throw new Error('BROWSER_SESSION_UNAVAILABLE')
    return session
  }
  const refresh = async (session: ManagedSession): Promise<BrowserSessionSnapshot> => {
    try {
      const host = await session.host.snapshot()
      session.snapshot = { ...session.snapshot, tabs: host.tabs, activeTabId: host.activeTabId }
    } catch (error) {
      session.snapshot = { ...session.snapshot, status: 'failed',
        error: error instanceof Error ? error.message : String(error) }
    }
    publish(session.snapshot)
    return structuredClone(session.snapshot)
  }
  return {
    async open(surface: BrowserSurface): Promise<BrowserSessionSnapshot> {
      if (surface !== 'embedded' && surface !== 'external-chrome')
        throw new Error('BROWSER_SURFACE_UNAVAILABLE')
      const sessionId = randomUUID()
      const host = await options.createHost(surface, sessionId)
      try {
        const state = await host.snapshot()
        const snapshot: BrowserSessionSnapshot = {
          sessionId, surface, status: 'running', error: null,
          tabs: state.tabs, activeTabId: state.activeTabId
        }
        sessions.set(snapshot.sessionId, { host, snapshot, queue: Promise.resolve(), closed: false })
        publish(snapshot)
        return structuredClone(snapshot)
      } catch (error) {
        await host.close()
        throw error
      }
    },
    async execute(sessionId: string, tabId: string, command: BrowserSessionCommand,
      actor: BrowserSessionActor): Promise<unknown> {
      const session = get(sessionId)
      const run = async () => {
        if (session.closed) throw new Error('BROWSER_SESSION_UNAVAILABLE')
        if (actor === 'agent' && session.snapshot.status !== 'running')
          throw new Error('BROWSER_AGENT_PAUSED')
        let state: Awaited<ReturnType<BrowserDesktopHostSession['snapshot']>>
        try { state = await session.host.snapshot() }
        catch (error) {
          session.snapshot = { ...session.snapshot, status: 'failed',
            error: error instanceof Error ? error.message : String(error) }
          publish(session.snapshot)
          throw error
        }
        if (!state.tabs.some(tab => tab.id === tabId))
          throw new Error('BROWSER_TAB_UNAVAILABLE')
        let result: unknown
        try { result = await session.host.execute(tabId, command) }
        catch (error) {
          session.snapshot = { ...session.snapshot, status: 'failed',
            error: error instanceof Error ? error.message : String(error) }
          publish(session.snapshot)
          throw error
        }
        await refresh(session)
        return result
      }
      const result = session.queue.then(run)
      session.queue = result.catch(() => {})
      return result
    },
    async transition(sessionId: string, control: BrowserSessionControl): Promise<BrowserSessionSnapshot> {
      const session = get(sessionId)
      const status: BrowserSessionStatus = control === 'pause' ? 'paused'
        : control === 'take-over' ? 'taken-over' : 'running'
      session.snapshot = { ...session.snapshot, status,
        error: status === 'running' ? null : session.snapshot.error }
      return refresh(session)
    },
    async snapshot(sessionId: string): Promise<BrowserSessionSnapshot> {
      return refresh(get(sessionId))
    },
    subscribe(listener: (snapshot: BrowserSessionSnapshot) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async close(sessionId: string): Promise<void> {
      const session = get(sessionId)
      session.closed = true
      sessions.delete(sessionId)
      await session.queue
      await session.host.close()
    }
  }
}
