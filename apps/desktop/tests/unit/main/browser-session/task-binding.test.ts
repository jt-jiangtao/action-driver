import { describe, expect, it } from 'vitest'
import { createBrowserDesktopSessionController } from '@action-driver/browser-desktop'
import type { BrowserDesktopHostSession } from '@action-driver/browser-desktop'

function makeController() {
  const operations: string[] = []
  const controller = createBrowserDesktopSessionController({
    async createHost(): Promise<BrowserDesktopHostSession> {
      return {
        async snapshot() {
          return { tabs: [{ id: 'tab-1', title: 'Start', url: 'about:blank',
            loading: false, canGoBack: false, canGoForward: false }], activeTabId: 'tab-1' }
        },
        async execute(_tabId, command) { operations.push(command.type); return {} },
        async close() { operations.push('closed') }
      }
    }
  })
  return { controller, operations }
}

describe('task browser binding', () => {
  it('binds browser sessions to tasks and rejects cross-task commands', async () => {
    const { controller, operations } = makeController()
    const { createTaskBrowserBinding } = await import('../../../../src/main/browser-session/task-binding.js')
    const binding = createTaskBrowserBinding(controller)
    const a = await binding.open('task-a', 'embedded')
    const b = await binding.open('task-b', 'external-chrome')

    expect(a.sessionId).not.toBe(b.sessionId)
    await expect(binding.execute('task-a', b.sessionId, 'tab-1',
      { type: 'click', x: 1, y: 1 }, 'agent')).rejects.toThrow('BROWSER_TASK_MISMATCH')
    expect(operations).toEqual([])
    await binding.execute('task-a', a.sessionId, 'tab-1',
      { type: 'click', x: 1, y: 1 }, 'agent')
    expect(operations).toEqual(['click'])
  })

  it('keeps embedded and external Chrome sessions separate within one task', async () => {
    const { controller, operations } = makeController()
    const { createTaskBrowserBinding } = await import('../../../../src/main/browser-session/task-binding.js')
    const binding = createTaskBrowserBinding(controller)
    const a = await binding.open('task-a', 'embedded')
    const b = await binding.open('task-b', 'embedded')
    const chrome = await binding.open('task-a', 'external-chrome')
    expect((await binding.snapshot('task-a'))?.sessionId).toBe(a.sessionId)
    expect((await binding.snapshot('task-a', 'external-chrome'))?.sessionId).toBe(chrome.sessionId)
    await expect(binding.open('task-a', 'embedded')).rejects.toThrow('BROWSER_TASK_SESSION_EXISTS')

    await binding.close('task-a', a.sessionId)
    expect((await binding.snapshot('task-a'))?.sessionId).toBe(chrome.sessionId)
    expect((await binding.snapshot('task-b'))?.sessionId).toBe(b.sessionId)
    expect(operations).toEqual(['closed'])
    const replacement = await binding.open('task-a', 'embedded')
    expect(replacement.surface).toBe('embedded')
  })

  it('coalesces concurrent opens of the same task surface', async () => {
    const { controller } = makeController()
    const { createTaskBrowserBinding } = await import('../../../../src/main/browser-session/task-binding.js')
    const binding = createTaskBrowserBinding(controller)
    const [first, second] = await Promise.all([
      binding.open('task-a', 'embedded'), binding.open('task-a', 'embedded')
    ])
    expect(first.sessionId).toBe(second.sessionId)
    expect(await binding.snapshots('task-a')).toHaveLength(1)
  })

  it('waits for an opening Chrome session before closing a task', async () => {
    let finish!: () => void
    const ready = new Promise<void>((resolve) => { finish = resolve })
    let closed = 0
    const controller = createBrowserDesktopSessionController({
      async createHost() {
        await ready
        return {
          async snapshot() { return { tabs: [{ id: 'tab-1', title: '', url: '',
            loading: false, canGoBack: false, canGoForward: false }], activeTabId: 'tab-1' } },
          async execute() {},
          async close() { closed += 1 }
        }
      }
    })
    const binding = (await import('../../../../src/main/browser-session/task-binding.js')).createTaskBrowserBinding(controller)
    const opening = binding.open('task-a', 'external-chrome')
    const closing = binding.closeTask('task-a')
    finish()
    await Promise.allSettled([opening, closing])
    expect(closed).toBe(1)
    expect(await binding.snapshots('task-a')).toEqual([])
  })
})
