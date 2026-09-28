import { responseObservationAllowed } from './service-response-lifecycle.js'

interface NotificationHost {
  addAfterSubmittedCodeHook(hook: { timeoutMs: number; run(): Promise<void> }): (() => void) | void
  emitContentItem(value: string): unknown
  credentialRegistry?: {
    isUnsafe(): boolean
    gates(): Array<{ usedNativeCredentials: boolean }>
    checkBroker(): Promise<unknown>
  }
  errorReporter?: { captureException(error: unknown): unknown }
}
interface PageEvent {
  type: string
  version: number
  tabId: number
  session_id: string
}
interface SessionApi {
  takePageEvents(): PageEvent[]
  matchesCurrentSessionId(id: string): boolean
}
interface Backend {
  api: SessionApi
  cdp: unknown
  preferences: { isWebMcpEnabled(): Promise<boolean> }
  getCurrentSessionId(): string
  tabLifecycle: {
    takeEvents(): Array<{ type: string; tabId: number; origin: string }>
  }
  security: {
    runCommand<T>(command: { type: string; params: { tab_id: string } }, run: () => Promise<T>): Promise<T>
  }
  webMcp: {
    clearSessionSnapshots(): void
    pendingNotificationTabIds(sessionId: string): number[]
    notificationForTab(tabId: number, deadlineMs: number): Promise<string>
  }
}
const isChanged = (event: PageEvent) =>
  event.version === 1 && event.type === 'webmcp_changed' &&
  Number.isInteger(event.tabId) && event.tabId > 0

export function createBrowserNotifications(host: NotificationHost) {
  const pending = new Map<SessionApi, Backend>()
  async function notificationForTab(backend: Backend, tabId: number, deadline: number, retry = true): Promise<string> {
    if (Date.now() >= deadline) return ''
    try {
      return await backend.security.runCommand(
        { type: 'webmcp_list_tools', params: { tab_id: String(tabId) } },
        () => backend.webMcp.notificationForTab(tabId, deadline)
      )
    } catch (error) {
      return retry && error instanceof Error &&
        error.message.includes('WebMCP tool registration is stale. Call fetchTools() again.')
        ? await notificationForTab(backend, tabId, deadline, false)
        : ''
    }
  }
  async function drain() {
    const deadline = Date.now() + 10000
    const snapshot = [...pending]
    pending.clear()
    const messages: string[] = []
    for (const [api, backend] of snapshot) {
      const page = api.takePageEvents().filter(
        (event) => event.version === 1 && api.matchesCurrentSessionId(event.session_id)
      )
      const tabs = backend.tabLifecycle.takeEvents()
      if (!responseObservationAllowed(host, backend)) continue
      if (!(await backend.preferences.isWebMcpEnabled())) {
        backend.webMcp?.clearSessionSnapshots?.()
        continue
      }
      const ids = new Set<number>(page.filter(isChanged).map((event) => event.tabId))
      for (const id of backend.webMcp?.pendingNotificationTabIds?.(backend.getCurrentSessionId()) ?? [])
        ids.add(id)
      for (const event of tabs)
        if (event.type === 'tab_acquired' && event.origin === 'external') ids.add(event.tabId)
      const notices = await Promise.all(
        [...ids].map((id) => notificationForTab(backend, id, deadline))
      )
      if (responseObservationAllowed(host, backend))
        messages.push(...notices.filter((item) => item.length > 0))
    }
    try {
      await host.credentialRegistry?.checkBroker()
    } catch { return '' }
    if (!responseObservationAllowed(host)) return ''
    return messages.length === 0 ? '' : `Browser notifications:\n\n${messages.join('\n\n')}\n`
  }
  const remove = host.addAfterSubmittedCodeHook({
    timeoutMs: 12000,
    async run() {
      try {
        const message = await drain()
        if (message) host.emitContentItem(message)
      } catch (error) {
        host.errorReporter?.captureException(error)
      }
    }
  })
  return {
    queue(api: SessionApi, backend: Backend) { pending.set(api, backend) },
    drain,
    dispose() { pending.clear(); if (typeof remove === 'function') remove() }
  }
}
