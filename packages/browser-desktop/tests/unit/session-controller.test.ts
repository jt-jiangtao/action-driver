import { describe, expect, it } from 'vitest'
import { createBrowserDesktopSessionController } from '../../src/index.js'
import type { BrowserDesktopHostSession, BrowserSessionCommand } from '../../src/session-contract.js'

function host(initialTab = 'tab-1') {
  const tabs = [{ id: initialTab, title: 'Start', url: 'about:blank', loading: false,
    canGoBack: false, canGoForward: false }]
  const received: Array<{ tabId: string; command: BrowserSessionCommand }> = []
  let closed = false
  const session: BrowserDesktopHostSession = {
    async snapshot() { return { tabs: [...tabs], activeTabId: tabs[0]?.id ?? null } },
    async execute(tabId, command) {
      received.push({ tabId, command })
      return { ok: true }
    },
    async close() { closed = true }
  }
  return { session, received, get closed() { return closed }, tabs }
}

describe('browser desktop session controller', () => {
  it('keeps sessions distinct and publishes serializable state without task ownership', async () => {
    const first = host('first-tab')
    const second = host('second-tab')
    const queue = [first.session, second.session]
    const controller = createBrowserDesktopSessionController({
      createHost: async () => queue.shift()!
    })
    const a = await controller.open('embedded')
    const b = await controller.open('external-chrome')

    expect(a.sessionId).not.toBe(b.sessionId)
    expect(a.surface).toBe('embedded')
    expect(b.surface).toBe('external-chrome')
    expect(a.tabs.map(tab => tab.id)).toEqual(['first-tab'])
    expect(b.tabs.map(tab => tab.id)).toEqual(['second-tab'])
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    expect('taskId' in a).toBe(false)
  })

  it('rejects an unknown tab instead of sending a command to the active tab', async () => {
    const target = host()
    const controller = createBrowserDesktopSessionController({ createHost: async () => target.session })
    const opened = await controller.open('embedded')

    await expect(controller.execute(opened.sessionId, 'closed-tab',
      { type: 'click', x: 10, y: 20 }, 'agent')).rejects.toThrow('BROWSER_TAB_UNAVAILABLE')
    expect(target.received).toEqual([])
  })

  it('rejects commands after close and closes only the owned host', async () => {
    const first = host('first-tab')
    const second = host('second-tab')
    const queue = [first.session, second.session]
    const controller = createBrowserDesktopSessionController({ createHost: async () => queue.shift()! })
    const a = await controller.open('embedded')
    const b = await controller.open('embedded')

    await controller.close(a.sessionId)
    expect(first.closed).toBe(true)
    expect(second.closed).toBe(false)
    await expect(controller.execute(a.sessionId, 'first-tab',
      { type: 'click', x: 1, y: 1 }, 'agent')).rejects.toThrow('BROWSER_SESSION_UNAVAILABLE')
    await controller.execute(b.sessionId, 'second-tab', { type: 'click', x: 2, y: 2 }, 'agent')
    expect(second.received).toHaveLength(1)
  })

  it('pauses agent commands during takeover while allowing user commands', async () => {
    const target = host()
    const controller = createBrowserDesktopSessionController({ createHost: async () => target.session })
    const opened = await controller.open('embedded')

    await controller.transition(opened.sessionId, 'take-over')
    await expect(controller.execute(opened.sessionId, 'tab-1',
      { type: 'click', x: 1, y: 1 }, 'agent')).rejects.toThrow('BROWSER_AGENT_PAUSED')
    await controller.execute(opened.sessionId, 'tab-1', { type: 'click', x: 2, y: 2 }, 'user')
    expect(target.received).toEqual([{ tabId: 'tab-1', command: { type: 'click', x: 2, y: 2 } }])
    await controller.transition(opened.sessionId, 'resume')
    expect((await controller.snapshot(opened.sessionId)).status).toBe('running')
  })

  it('publishes host failures and clears the error after explicit resume', async () => {
    const target = host()
    target.session.execute = async () => { throw new Error('Chrome window closed') }
    const controller = createBrowserDesktopSessionController({ createHost: async () => target.session })
    const observed: string[] = []
    controller.subscribe((snapshot) => { if (snapshot.error) observed.push(snapshot.error) })
    const opened = await controller.open('external-chrome')
    await expect(controller.execute(opened.sessionId, 'tab-1',
      { type: 'refresh' }, 'agent')).rejects.toThrow('Chrome window closed')
    expect(observed).toContain('Chrome window closed')
    expect((await controller.snapshot(opened.sessionId)).status).toBe('failed')
    const resumed = await controller.transition(opened.sessionId, 'resume')
    expect(resumed.status).toBe('running')
    expect(resumed.error).toBeNull()
  })
})
