import { expect, it, vi } from 'vitest'

it('binds a viewport to the task-owned embedded session and hides it on close', async () => {
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>()
  const viewport = vi.fn()
  const close = vi.fn(async () => undefined)
  const { createDesktopBrowserSessionManager } = await import('../../../../src/main/browser-session/manager')
  createDesktopBrowserSessionManager({
    ipc: { handle: (channel, handler) => { handlers.set(channel, handler) } },
    isTrustedSender: () => true,
    emit: vi.fn(),
    createEmbeddedHost: async () => ({
      snapshot: async () => ({ tabs: [{ id: 'tab-1', title: '', url: '', loading: false,
        canGoBack: false, canGoForward: false }], activeTabId: 'tab-1' }),
      execute: async () => undefined, close, setViewport: viewport
    }),
    createExternalHost: async () => { throw new Error('unused') }
  })
  const command = handlers.get('browser-session:command')!
  const setViewport = handlers.get('browser-session:viewport')!
  const snapshot = await command({}, { action: 'open', taskId: 'task-1', surface: 'embedded' }) as {
    sessionId: string
  }
  await expect(setViewport({}, { taskId: 'other', sessionId: snapshot.sessionId,
    bounds: { x: 1, y: 2, width: 300, height: 200 }, visible: true }))
    .rejects.toThrow('BROWSER_TASK_MISMATCH')
  await setViewport({}, { taskId: 'task-1', sessionId: snapshot.sessionId,
    bounds: { x: 1, y: 2, width: 300, height: 200 }, visible: true })
  expect(viewport).toHaveBeenCalledWith({ x: 1, y: 2, width: 300, height: 200 }, true)
  await command({}, { action: 'close', taskId: 'task-1', sessionId: snapshot.sessionId })
  expect(close).toHaveBeenCalledOnce()
})
