// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createLocalBrowserHost } from '../../../../src/main/browser-session/local-browser-host'
import { setupBrowserRuntime } from '@action-driver/browser-runtime'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})
async function profileRoot() {
  const root = await mkdtemp(join(tmpdir(), 'action-driver-browser-test-'))
  roots.push(root)
  return root
}

test('owns a profile, browser tabs, navigation and screenshot and cleans up on close', async () => {
  const root = await profileRoot()
  let launchedProfile = ''
  const page = {
    url: vi.fn(() => 'about:blank'), title: vi.fn(async () => 'Local'),
    goto: vi.fn(async (url: string) => { page.url.mockReturnValue(url) }),
    screenshot: vi.fn(async () => Buffer.from([1, 2, 3])),
    close: vi.fn(async () => {})
  }
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async () => ({ result: { value: 2 } })), detach: vi.fn(async () => {})
  })
  const context = {
    pages: vi.fn(() => [page]), newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}), on: vi.fn(), off: vi.fn(),
    newCDPSession: vi.fn(async () => session)
  }
  const host = await createLocalBrowserHost({
    profileRoot: root,
    launch: async (path) => { launchedProfile = path; return context as never }
  })
  const setup = await host.setup({ environment: 'training' })
  expect(setup.apiManifest).toBeTruthy()
  expect(setup.disabledMemberIds).toContain('Tab.playwright')
  expect(setup.disabledMemberIds).toContain('Tab.ax')
  expect(setup.disabledMemberIds).toContain('CUAAPI.downloadMedia')
  expect(setup.disabledMemberIds).not.toContain('Tab.cua')
  expect(setup.disabledMemberIds).not.toContain('CUAAPI.click')
  expect(await host.execute({ type: 'list_browsers' })).toMatchObject([{ id: 'local', type: 'cdp' }])
  expect(await host.execute({ type: 'list_tabs', browser_id: 'local' })).toMatchObject({ tabs: [{ url: 'about:blank' }] })
  const created = await host.execute({ type: 'create_tab', browser_id: 'local' }) as { id: string }
  await host.execute({ type: 'navigate_tab_url', browser_id: 'local', tab_id: created.id, url: 'http://127.0.0.1/' })
  expect(page.goto).toHaveBeenCalledWith('http://127.0.0.1/')
  expect(await host.execute({ type: 'tab_screenshot', browser_id: 'local', tab_id: created.id }))
    .toEqual({ data: 'AQID' })
  await host.execute({ type: 'tab_screenshot', browser_id: 'local', tab_id: created.id,
    cropX: 1, cropY: 2, cropWidth: 3, cropHeight: 4 })
  expect(page.screenshot).toHaveBeenLastCalledWith({ fullPage: false,
    clip: { x: 1, y: 2, width: 3, height: 4 } })
  await expect(host.execute({ type: 'tab_screenshot', browser_id: 'local', tab_id: created.id,
    cropX: 1, cropY: 2, cropWidth: -1, cropHeight: 4 })).rejects.toThrow('BROWSER_SCREENSHOT_CLIP_INVALID')
  expect(await host.execute({ type: 'tab_cdp_call', browser_id: 'local', tab_id: created.id,
    method: 'Runtime.evaluate', params: { expression: '1+1' } }))
    .toEqual({ result: { value: 2 } })
  const events = host.execute({ type: 'tab_cdp_events', browser_id: 'local', tab_id: created.id,
    methods: ['Page.loadEventFired'], timeout_ms: 100 })
  await vi.waitFor(() => expect(session.listenerCount('event')).toBe(1))
  session.emit('event', { method: 'Page.loadEventFired', params: { timestamp: 1 } })
  expect(await events).toMatchObject({ events: [{ method: 'Page.loadEventFired' }] })
  await host.close()
  expect(context.close).toHaveBeenCalledOnce()
  expect(session.detach).toHaveBeenCalledOnce()
  expect(await readdir(root)).toEqual([])
  expect(launchedProfile).toContain(root)
  await expect(host.execute({ type: 'list_browsers' })).rejects.toThrow('BROWSER_HOST_CLOSED')
})

test('failed launch cleans profile and rejects private App paths', async () => {
  const root = await profileRoot()
  await expect(createLocalBrowserHost({ profileRoot: root,
    launch: async () => { throw new Error('CDP handshake failed') }
  })).rejects.toThrow('CDP handshake failed')
  expect(await readdir(root)).toEqual([])
  await expect(createLocalBrowserHost({ profileRoot: root,
    browserExecutable: '/Applications/ChatGPT.app/Contents/Resources/cua_node/browser',
    launch: async () => { throw new Error('should not launch') }
  })).rejects.toThrow('BROWSER_PRIVATE_PATH')
})

test('owned browser maps tab discovery and pointer/keyboard actions to its page', async () => {
  const root = await profileRoot()
  const page = {
    url: () => 'http://127.0.0.1/', title: async () => 'Local',
    mouse: { click: vi.fn(), move: vi.fn(), wheel: vi.fn(), down: vi.fn(), up: vi.fn(), dblclick: vi.fn() },
    keyboard: { press: vi.fn(), insertText: vi.fn() },
    on: vi.fn()
  }
  const context = { pages: () => [page], close: vi.fn(async () => {}) }
  const host = await createLocalBrowserHost({ profileRoot: root,
    launch: async () => context as never })
  try {
    const listed = await host.execute({ type: 'browser_user_open_tabs', browser_id: 'local' }) as any
    const id = listed.tabs[0].id
    expect(await host.execute({ type: 'browser_user_claim_tab', browser_id: 'local', tab_id: id }))
      .toEqual({ id, title: 'Local', url: 'http://127.0.0.1/' })
    await host.execute({ type: 'cua_click', browser_id: 'local', tab_id: id, x: 2, y: 3, button: 1 })
    await host.execute({ type: 'cua_double_click', browser_id: 'local', tab_id: id, x: 4, y: 5 })
    await host.execute({ type: 'cua_move', browser_id: 'local', tab_id: id, x: 6, y: 7 })
    await host.execute({ type: 'cua_scroll', browser_id: 'local', tab_id: id, x: 8, y: 9, scroll_x: 10, scroll_y: 11 })
    await host.execute({ type: 'cua_keypress', browser_id: 'local', tab_id: id, keys: ['ENTER'] })
    await host.execute({ type: 'cua_type', browser_id: 'local', tab_id: id, text: 'hello' })
    await host.execute({ type: 'cua_drag', browser_id: 'local', tab_id: id,
      path: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] })
    expect(page.mouse.click).toHaveBeenCalledWith(2, 3, { button: 'left' })
    expect(page.mouse.dblclick).toHaveBeenCalledWith(4, 5)
    expect(page.mouse.move).toHaveBeenCalledWith(8, 9)
    expect(page.mouse.wheel).toHaveBeenCalledWith(10, 11)
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter')
    expect(page.keyboard.insertText).toHaveBeenCalledWith('hello')
    expect(page.mouse.down).toHaveBeenCalledOnce()
    expect(page.mouse.up).toHaveBeenCalledOnce()
    expect(page.mouse.move).toHaveBeenLastCalledWith(5, 6)
    await expect(host.execute({ type: 'cua_click', browser_id: 'local', tab_id: id,
      x: 1, y: 1, keys: ['ALT'] })).rejects.toThrow('BROWSER_MODIFIER_UNAVAILABLE')
  } finally { await host.close() }
})

test('composed public browser client operates through the owned local host', async () => {
  const root = await profileRoot()
  let address = 'about:blank'
  const page = {
    url: () => address, title: async () => 'Fixture',
    goto: vi.fn(async (url: string) => { address = url }),
    screenshot: vi.fn(async () => Buffer.from([1, 2, 3])),
    mouse: { click: vi.fn() }, keyboard: { insertText: vi.fn() },
    on: vi.fn(), close: vi.fn(async () => {})
  }
  const context = {
    pages: () => [page], newPage: async () => page,
    close: vi.fn(async () => {})
  }
  const host = await createLocalBrowserHost({ profileRoot: root,
    launch: async () => context as never })
  try {
    const agent = await setupBrowserRuntime({ host, environment: 'training' })
    const browser = await agent.browsers.getDefault()
    const tab = await browser.tabs.new()
    await tab.goto('http://127.0.0.1/')
    await tab.cua.click({ x: 1, y: 2 })
    await tab.cua.type({ text: 'hello' })
    expect(await tab.url()).toBe('http://127.0.0.1/')
    expect(await tab.screenshot()).toEqual(new Uint8Array([1, 2, 3]))
    expect(page.mouse.click).toHaveBeenCalledOnce()
    expect(page.keyboard.insertText).toHaveBeenCalledWith('hello')
    expect(tab.playwright).toBeUndefined()
  } finally { await host.close() }
})
