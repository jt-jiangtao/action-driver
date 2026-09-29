import { expect, it, vi } from 'vitest'
import { createBrowserDesktopSessionController } from '@actiondriver/browser-desktop'
import { createTaskBrowserBinding } from '../../../../src/main/browser-session/task-binding.js'
import { createTaskBrowserRpc } from '../../../../src/main/browser-session/cua-rpc.js'

it('routes CUA browser commands to the task-owned embedded and Chrome sessions', async () => {
  const calls: string[] = []
  const controller = createBrowserDesktopSessionController({
    async createHost(surface) {
      const tabs = new Map([['tab-1', { id: 'tab-1', title: surface, url: 'about:blank',
        loading: false, canGoBack: false, canGoForward: false }]])
      return {
        async snapshot() { return { tabs: [...tabs.values()], activeTabId: 'tab-1' } },
        async execute(tabId, command) {
          calls.push(`${surface}:${command.type}:${tabId}`)
          if (command.type === 'create-tab') {
            tabs.set('tab-2', { ...tabs.get('tab-1')!, id: 'tab-2' })
            return 'tab-2'
          }
          if (command.type === 'close-tab') tabs.delete(tabId)
          if (command.type === 'navigate') tabs.get(tabId)!.url = command.url
          if (command.type === 'screenshot') return { mimeType: 'image/png', bytes: new Uint8Array([1, 2]) }
          if (command.type === 'ax-state') return '- document "Fixture"'
        },
        close: vi.fn(async () => {})
      }
    }
  })
  const binding = createTaskBrowserBinding(controller)
  const rpc = createTaskBrowserRpc(binding)
  expect(await rpc('task-a', { type: 'list_browsers' })).toEqual([
    expect.objectContaining({ id: 'iab' }), expect.objectContaining({ id: 'chrome' })
  ])
  expect(await rpc('task-a', { type: 'get_browser', id: 'iab' }))
    .toEqual(expect.objectContaining({ id: 'iab' }))
  expect(await rpc('task-a', { type: 'get_browser', id: 'chrome' }))
    .toEqual(expect.objectContaining({ id: 'chrome' }))
  expect((await rpc('task-a', { type: 'create_tab', browser_id: 'chrome' }) as { id: string }).id)
    .toBe('tab-2')
  await rpc('task-a', { type: 'navigate_tab_url', browser_id: 'iab',
    tab_id: 'tab-1', url: 'https://example.org' })
  expect(await rpc('task-a', { type: 'get_tab', browser_id: 'iab', tab_id: 'tab-1' }))
    .toEqual(expect.objectContaining({ url: 'https://example.org' }))
  expect(await rpc('task-a', { type: 'tab_screenshot', browser_id: 'iab', tab_id: 'tab-1' }))
    .toEqual({ data: 'AQI=' })
  await rpc('task-a', { type: 'tab_screenshot', browser_id: 'iab', tab_id: 'tab-1',
    cropX: 1, cropY: 2, cropWidth: 3, cropHeight: 4 })
  await rpc('task-a', { type: 'tab_screenshot', browser_id: 'iab', tab_id: 'tab-1',
    fullPage: true })
  await expect(rpc('task-a', { type: 'tab_screenshot', browser_id: 'iab', tab_id: 'tab-1',
    cropX: 1 })).rejects.toThrow('BROWSER_SCREENSHOT_CLIP_INVALID')
  expect(await rpc('task-a', { type: 'tab_ax_get_state', browser_id: 'iab',
    tab_id: 'tab-1', content: 'axState' })).toEqual({ state: '- document "Fixture"' })
  expect(await rpc('task-a', { type: 'tab_ax_get_state', browser_id: 'iab',
    tab_id: 'tab-1', content: 'screenshot' })).toEqual({ data: 'AQI=' })
  expect(await rpc('task-a', { type: 'get_browser_documentation', browser_id: 'iab' }))
    .toEqual(expect.any(String))
  for (const type of ['navigate_tab_back', 'navigate_tab_forward', 'navigate_tab_reload'])
    await rpc('task-a', { type, browser_id: 'iab', tab_id: 'tab-1' })
  await rpc('task-a', { type: 'cua_double_click', browser_id: 'iab', tab_id: 'tab-1', x: 3, y: 4 })
  await rpc('task-a', { type: 'cua_click', browser_id: 'iab', tab_id: 'tab-1',
    x: 3, y: 4, button: 3 })
  await rpc('task-a', { type: 'cua_move', browser_id: 'iab', tab_id: 'tab-1', x: 3, y: 4 })
  await rpc('task-a', { type: 'cua_keypress', browser_id: 'iab', tab_id: 'tab-1', keys: ['ENTER'] })
  await rpc('task-a', { type: 'cua_drag', browser_id: 'iab', tab_id: 'tab-1',
    path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
  expect(calls).toEqual(expect.arrayContaining([
    'embedded:back:tab-1', 'embedded:forward:tab-1', 'embedded:refresh:tab-1',
    'embedded:double-click:tab-1', 'embedded:move:tab-1',
    'embedded:keypress:tab-1', 'embedded:drag:tab-1'
  ]))
  expect(calls).toContain('embedded:navigate:tab-1')
  expect(calls).toContain('external-chrome:create-tab:tab-1')
  await expect(rpc('task-b', { type: 'get_tab', browser_id: 'unknown', tab_id: 'tab-1' }))
    .rejects.toThrow('BROWSER_UNAVAILABLE')
})

it('rejects stale tabs and agent actions during takeover', async () => {
  const controller = createBrowserDesktopSessionController({
    async createHost() {
      const tabs = new Map([['tab-1', { id: 'tab-1', title: '', url: '', loading: false,
        canGoBack: false, canGoForward: false }]])
      return {
        async snapshot() { return { tabs: [...tabs.values()], activeTabId: 'tab-1' } },
        async execute(tabId, command) {
          if (command.type === 'close-tab') tabs.delete(tabId)
        },
        async close() {}
      }
    }
  })
  const binding = createTaskBrowserBinding(controller)
  const rpc = createTaskBrowserRpc(binding)
  const session = await binding.open('task-a', 'embedded')
  await rpc('task-a', { type: 'close_tab', browser_id: 'iab', tab_id: 'tab-1' })
  await expect(rpc('task-a', { type: 'cua_click', browser_id: 'iab',
    tab_id: 'tab-1', x: 1, y: 2 })).rejects.toThrow('BROWSER_TAB_UNAVAILABLE')
  await binding.transition('task-a', session.sessionId, 'take-over')
  await expect(rpc('task-a', { type: 'create_tab', browser_id: 'iab' }))
    .rejects.toThrow('BROWSER_AGENT_PAUSED')
})

it('keeps the embedded browser usable when isolated Chrome cannot launch', async () => {
  const controller = createBrowserDesktopSessionController({
    async createHost(surface) {
      if (surface === 'external-chrome') throw new Error('CHROME_UNAVAILABLE')
      return {
        async snapshot() { return { tabs: [{ id: 'tab-1', title: 'Embedded', url: '',
          loading: false, canGoBack: false, canGoForward: false }], activeTabId: 'tab-1' } },
        async execute() {},
        async close() {}
      }
    }
  })
  const rpc = createTaskBrowserRpc(createTaskBrowserBinding(controller))
  await expect(rpc('task-a', { type: 'list_tabs', browser_id: 'chrome' }))
    .rejects.toThrow('CHROME_UNAVAILABLE')
  expect(await rpc('task-a', { type: 'list_tabs', browser_id: 'iab' }))
    .toEqual({ tabs: [expect.objectContaining({ id: 'tab-1' })] })
})
