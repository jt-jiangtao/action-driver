import { createBrowserDesktopSessionController } from '@action-driver/browser-desktop'
import type { BrowserDesktopHostSession, BrowserSessionSnapshot } from '@action-driver/browser-desktop'
import { BROWSER_SESSION_VIEWPORT_CHANNEL } from '../../shared/browser-session-contract.js'
import { registerBrowserSessionIpc } from './ipc.js'
import { createTaskBrowserBinding } from './task-binding.js'

type Bounds = { x: number; y: number; width: number; height: number }
type Host = BrowserDesktopHostSession & { setViewport?(bounds: Bounds, visible: boolean): void }
type Ipc = { handle(channel: string,
  handler: (event: unknown, input: unknown) => Promise<unknown>): void }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function createDesktopBrowserSessionManager(options: {
  ipc: Ipc
  isTrustedSender(event: unknown): boolean
  emit(taskId: string, snapshot: BrowserSessionSnapshot | null): void
  createEmbeddedHost(onChanged: () => void): Promise<Host>
  createExternalHost(): Promise<Host>
}) {
  const hosts = new Map<string, Host>()
  const controller = createBrowserDesktopSessionController({
    async createHost(surface, sessionId) {
      const host = surface === 'embedded'
        ? await options.createEmbeddedHost(() => {
          const taskId = binding?.taskForSession(sessionId)
          if (taskId) void controller.snapshot(sessionId).then((snapshot) =>
            options.emit(taskId, snapshot)).catch(() => {})
        }) : await options.createExternalHost()
      hosts.set(sessionId, host)
      return { ...host, close: async () => {
        hosts.delete(sessionId)
        await host.close()
      } }
    }
  })
  const binding = createTaskBrowserBinding(controller)
  registerBrowserSessionIpc(options.ipc, binding, options.isTrustedSender, options.emit)
  options.ipc.handle(BROWSER_SESSION_VIEWPORT_CHANNEL, async (event, input) => {
    if (!options.isTrustedSender(event)) throw new Error('BROWSER_IPC_UNTRUSTED')
    if (!record(input) || typeof input.taskId !== 'string' ||
        typeof input.sessionId !== 'string' || !record(input.bounds) ||
        typeof input.visible !== 'boolean') throw new Error('BROWSER_VIEWPORT_INVALID')
    const { x, y, width, height } = input.bounds
    if (![x, y, width, height].every((number) =>
      typeof number === 'number' && Number.isFinite(number)) ||
      (width as number) < 0 || (height as number) < 0)
      throw new Error('BROWSER_VIEWPORT_INVALID')
    const snapshot = await binding.snapshot(input.taskId)
    if (snapshot?.sessionId !== input.sessionId) {
      if (input.visible === false) return null
      throw new Error('BROWSER_TASK_MISMATCH')
    }
    const host = hosts.get(input.sessionId)
    if (!host?.setViewport) throw new Error('BROWSER_VIEWPORT_UNAVAILABLE')
    host.setViewport({ x: x as number, y: y as number,
      width: width as number, height: height as number }, input.visible)
    return null
  })
  return {
    binding,
    async dispose() {
      await Promise.all([...hosts.keys()].map(async (id) => {
        try { await controller.close(id) } catch { /* already closed */ }
      }))
    }
  }
}
