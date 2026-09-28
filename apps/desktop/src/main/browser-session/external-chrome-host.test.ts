import { expect, it, vi } from 'vitest'

it('maps managed Chrome tabs and actions without touching other browser instances', async () => {
  const execute = vi.fn(async (command: Record<string, unknown>): Promise<unknown> => {
    if (command.type === 'list_tabs') return { tabs: [{ id: '7', title: 'Example',
      url: 'https://example.test/' }] }
    if (command.type === 'tab_screenshot') return { data: Buffer.from('png').toString('base64') }
    return {}
  })
  const close = vi.fn(async () => undefined)
  const { createExternalChromeHost } = await import('./external-chrome-host')
  const host = createExternalChromeHost({ execute, close } as never)
  const snapshot = await host.snapshot()
  expect(snapshot.activeTabId).toBe('7')
  await host.execute('7', { type: 'navigate', url: 'https://example.test/next' })
  expect(execute).toHaveBeenCalledWith({ type: 'navigate_tab_url', browser_id: 'local',
    tab_id: '7', url: 'https://example.test/next' })
  await host.execute('7', { type: 'click', x: 10, y: 20 })
  expect(execute).toHaveBeenCalledWith({ type: 'cua_click', browser_id: 'local',
    tab_id: '7', x: 10, y: 20 })
  await host.execute('7', { type: 'double-click', x: 11, y: 21 })
  await host.execute('7', { type: 'drag', path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
  await host.execute('7', { type: 'keypress', keys: ['ENTER'] })
  await host.execute('7', { type: 'screenshot', fullPage: true })
  expect(execute).toHaveBeenCalledWith({ type: 'cua_double_click', browser_id: 'local',
    tab_id: '7', x: 11, y: 21 })
  expect(execute).toHaveBeenCalledWith({ type: 'cua_drag', browser_id: 'local',
    tab_id: '7', path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
  expect(execute).toHaveBeenCalledWith({ type: 'cua_keypress', browser_id: 'local',
    tab_id: '7', keys: ['ENTER'] })
  expect(execute).toHaveBeenCalledWith({ type: 'tab_screenshot', browser_id: 'local',
    tab_id: '7', fullPage: true })
  await expect(host.execute('other', { type: 'refresh' })).rejects.toThrow('BROWSER_TAB_UNAVAILABLE')
  await host.close()
  expect(close).toHaveBeenCalledOnce()
})
