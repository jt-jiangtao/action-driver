interface SessionApi {
  getCurrentSessionId(): string | undefined
  getCurrentTurnId(): string | undefined
}
type Origin = 'agent' | 'external'
export interface TabLifecycleEvent {
  type: 'tab_created' | 'tab_acquired'
  tabId: number
  origin: Origin
}
interface SessionState {
  acquiredTabs: Map<number, Origin>
  claimedTurnIds: Map<number, string>
  pendingEvents: TabLifecycleEvent[]
}
export class TabLifecycle {
  sessions = new Map<string | undefined, SessionState>()
  constructor(private api: SessionApi) {}
  recordCreated(tabId: number) {
    const session = this.currentSession()
    session.acquiredTabs.set(tabId, 'agent')
    const turn = this.api.getCurrentTurnId()
    if (turn != null) session.claimedTurnIds.set(tabId, turn)
    session.pendingEvents.push({ type: 'tab_created', tabId, origin: 'agent' })
  }
  recordAcquired(tabId: number, origin: Origin = 'external') {
    const session = this.currentSession(),
      turn = this.api.getCurrentTurnId()
    if (turn != null) session.claimedTurnIds.set(tabId, turn)
    if (!session.acquiredTabs.has(tabId)) {
      session.acquiredTabs.set(tabId, origin)
      session.pendingEvents.push({ type: 'tab_acquired', tabId, origin })
    }
  }
  needsReclaim(tabId: number) {
    const turn = this.api.getCurrentTurnId()
    if (turn == null) return false
    const session = this.currentSession()
    return session.acquiredTabs.has(tabId) && session.claimedTurnIds.get(tabId) !== turn
  }
  takeEvents() {
    return this.currentSession().pendingEvents.splice(0)
  }
  currentSession() {
    const id = this.api.getCurrentSessionId()
    let session = this.sessions.get(id)
    if (session === undefined) {
      session = { acquiredTabs: new Map(), claimedTurnIds: new Map(), pendingEvents: [] }
      this.sessions.set(id, session)
    }
    return session
  }
}
