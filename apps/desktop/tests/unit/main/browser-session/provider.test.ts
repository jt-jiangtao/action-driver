import { expect, it, vi } from 'vitest'

it('uses the task-owned session and agent actor for Browser Use commands', async () => {
  const binding = {
    open: vi.fn(async () => ({ sessionId: 'session-1', activeTabId: 'tab-1',
      surface: 'embedded', status: 'running', tabs: [], error: null })),
    execute: vi.fn(async () => ({ ok: true })),
    snapshot: vi.fn(async () => ({ sessionId: 'session-1', activeTabId: 'tab-1',
      surface: 'embedded', status: 'running', tabs: [], error: null })),
    close: vi.fn(async () => undefined)
  }
  const { createBrowserUseProvider } = await import('../../../../src/main/browser-session/provider')
  const emit = vi.fn()
  const provider = createBrowserUseProvider(binding as never, emit)
  await expect(provider.execute({ taskId: 'task-1', action: 'open', surface: 'embedded' }))
    .resolves.toMatchObject({ sessionId: 'session-1' })
  expect(emit).toHaveBeenCalledWith('task-1', expect.objectContaining({ sessionId: 'session-1' }))
  await provider.execute({ taskId: 'task-1', action: 'execute', sessionId: 'session-1',
    tabId: 'tab-1', command: { type: 'click', x: 5, y: 7 } })
  expect(binding.execute).toHaveBeenCalledWith('task-1', 'session-1', 'tab-1',
    { type: 'click', x: 5, y: 7 }, 'agent')
  expect(emit).toHaveBeenCalledTimes(2)
  await expect(provider.execute({ taskId: 'task-1', action: 'transition',
    sessionId: 'session-1', control: 'take-over' })).rejects.toThrow('BROWSER_AGENT_CONTROL_UNAVAILABLE')
})
