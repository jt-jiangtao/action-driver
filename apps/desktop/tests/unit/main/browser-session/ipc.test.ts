import { describe, expect, it } from 'vitest'
import { createBrowserDesktopSessionController } from '@actiondriver/browser-desktop'
import { createTaskBrowserBinding } from '../../../../src/main/browser-session/task-binding.js'
import { BROWSER_SESSION_COMMAND_CHANNEL } from '../../../../src/shared/browser-session-contract.js'

describe('browser session IPC', () => {
  it('accepts only trusted renderer commands for the owning task', async () => {
    const controller = createBrowserDesktopSessionController({
      async createHost() {
        return {
          async snapshot() { return { activeTabId: 'tab-1', tabs: [{ id: 'tab-1',
            title: 'Start', url: 'about:blank', loading: false,
            canGoBack: false, canGoForward: false }] } },
          async execute() { return {} },
          async close() {}
        }
      }
    })
    const binding = createTaskBrowserBinding(controller)
    let handler: ((event: unknown, input: unknown) => Promise<unknown>) | undefined
    const { registerBrowserSessionIpc } = await import('../../../../src/main/browser-session/ipc.js')
    registerBrowserSessionIpc({ handle(channel, callback) {
      expect(channel).toBe(BROWSER_SESSION_COMMAND_CHANNEL)
      handler = callback
    } }, binding, event => event === 'trusted', () => {})

    await expect(handler?.('untrusted', { action: 'open', taskId: 'task-a',
      surface: 'embedded' })).rejects.toThrow('BROWSER_IPC_UNTRUSTED')
    const opened = await handler?.('trusted', { action: 'open', taskId: 'task-a',
      surface: 'embedded' }) as { sessionId: string }
    expect(opened.sessionId).toBeTruthy()
    await expect(handler?.('trusted', { action: 'execute', taskId: 'task-b',
      sessionId: opened.sessionId, tabId: 'tab-1',
      command: { type: 'click', x: 1, y: 2 } })).rejects.toThrow('BROWSER_TASK_MISMATCH')
  })

  it('rejects malformed commands and private navigation schemes', async () => {
    const controller = createBrowserDesktopSessionController({ createHost: async () => ({
      async snapshot() { return { activeTabId: null, tabs: [] } },
      async execute() { return {} }, async close() {}
    }) })
    const binding = createTaskBrowserBinding(controller)
    let handler: ((event: unknown, input: unknown) => Promise<unknown>) | undefined
    const { registerBrowserSessionIpc } = await import('../../../../src/main/browser-session/ipc.js')
    registerBrowserSessionIpc({ handle(_channel, callback) { handler = callback } },
      binding, () => true, () => {})

    for (const request of [
      null,
      { action: 'open', taskId: '', surface: 'embedded' },
      { action: 'execute', taskId: 't', sessionId: 's', tabId: 'x',
        command: { type: 'navigate', url: 'file:///tmp/private' } },
      { action: 'execute', taskId: 't', sessionId: 's', tabId: 'x',
        command: { type: 'click', x: Number.NaN, y: 1 } },
      { action: 'execute', taskId: 't', sessionId: 's', tabId: 'x',
        command: { type: 'screenshot', clip: { x: 0, y: 0, width: -1, height: 2 } } },
      { action: 'execute', taskId: 't', sessionId: 's', tabId: 'x',
        command: { type: 'drag', path: [{ x: 1, y: 2 }] } }
    ]) {
      await expect(handler?.('trusted', request)).rejects.toThrow('BROWSER_IPC_INVALID')
    }
  })
})
