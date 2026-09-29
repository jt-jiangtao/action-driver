import { getElectronForkExecutable } from './support/electron-fork'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, _electron as electron } from '@playwright/test'
import { FakeOpenAiToolServer } from './support/fake-openai-tool-server'

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url))

test('owns an embedded page and an independently launched Chrome session', async () => {
  test.setTimeout(60_000)
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-browser-e2e-'))
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<title>${request.url === '/second' ? 'Second' : 'First'}</title><h1>Browser acceptance</h1><input style="position:absolute;left:10px;top:55px;width:240px;height:40px" oninput="document.title='Typed '+this.value"><a href="/popup" target="_blank" style="position:absolute;left:10px;top:130px">Open popup</a>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server address missing')
  const url = `http://127.0.0.1:${address.port}`
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    application = await electron.launch({ executablePath: await getElectronForkExecutable(), args: ['.', `--user-data-dir=${join(directory, 'data')}`],
      cwd: desktopRoot, env: { ...Object.fromEntries(Object.entries(process.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')), HOME: directory,
        ACTIONDRIVER_E2E_HOME_DIRECTORY: directory } })
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    const result = await page.evaluate(async (origin) => {
      const api = window.actionDriverDesktop.browserSession
      const taskId = 'browser-acceptance'
      const embedded = await api.command({ action: 'open', taskId, surface: 'embedded' })
      if (!embedded?.sessionId || !embedded.activeTabId) throw new Error('embedded session missing')
      const added = await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: embedded.activeTabId,
        command: { type: 'create-tab' } })
      if (!added?.activeTabId || added.activeTabId === embedded.activeTabId || added.tabs.length !== 2)
        throw new Error('new tab did not become active')
      await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: added.activeTabId,
        command: { type: 'close-tab' } })
      const navigated = await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: embedded.activeTabId,
        command: { type: 'navigate', url: `${origin}/first` } })
      await api.setViewport({ taskId, sessionId: embedded.sessionId,
        bounds: { x: 0, y: 0, width: 600, height: 400 }, visible: true })
      await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: embedded.activeTabId,
        command: { type: 'click', x: 30, y: 70 } })
      const typed = await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: embedded.activeTabId,
        command: { type: 'type', text: 'hello' } })
      await new Promise((resolve) => setTimeout(resolve, 150))
      const image = await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: embedded.activeTabId,
        command: { type: 'screenshot' } })
      await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: embedded.activeTabId,
        command: { type: 'click', x: 30, y: 140 } })
      await new Promise((resolve) => setTimeout(resolve, 150))
      const popup = await api.command({ action: 'snapshot', taskId })
      if (!popup?.activeTabId || popup.tabs.length !== 2) throw new Error('managed popup missing')
      await api.command({ action: 'execute', taskId,
        sessionId: embedded.sessionId, tabId: popup.activeTabId,
        command: { type: 'close-tab' } })
      await api.command({ action: 'close', taskId, sessionId: embedded.sessionId })
      const chrome = await api.command({ action: 'open', taskId, surface: 'external-chrome' })
      if (!chrome?.sessionId || !chrome.activeTabId) throw new Error('Chrome session missing')
      const external = await api.command({ action: 'execute', taskId,
        sessionId: chrome.sessionId, tabId: chrome.activeTabId,
        command: { type: 'navigate', url: `${origin}/second` } })
      await api.command({ action: 'close', taskId, sessionId: chrome.sessionId })
      return { added, navigated, typed, image, popup, external }
    }, url)
    expect(result.added?.tabs).toHaveLength(2)
    expect(result.navigated?.tabs?.[0]?.url).toBe(`${url}/first`)
    expect(result.typed?.tabs?.[0]?.title).toBeTruthy()
    expect(result.image?.tabs?.[0]?.title).toBe('Typed hello')
    expect(result.popup?.tabs).toHaveLength(2)
    expect(result.external?.tabs?.[0]?.url).toBe(`${url}/second`)
  } finally {
    await application?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shows the page opened and navigated by the task agent in the right browser panel', async () => {
  test.setTimeout(60_000)
  const directory = mkdtempSync(join(tmpdir(), 'ad-browser-agent-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Agent Target</title><h1>Agent opened this page</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server address missing')
  const provider = new FakeOpenAiToolServer('browser-embedded')
  await provider.start()
  provider.browserTargetUrl = `http://127.0.0.1:${address.port}/agent`
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    application = await electron.launch({ executablePath: await getElectronForkExecutable(), args: ['.', `--user-data-dir=${join(directory, 'data')}`],
      cwd: desktopRoot, env: { ...Object.fromEntries(Object.entries(process.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
        HOME: directory, ACTIONDRIVER_E2E_HOME_DIRECTORY: directory } })
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await page.evaluate(async (baseUrl) => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const endpoint = new URL(connection.wsUrl)
      endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:'
      endpoint.pathname = '/model-connections'
      const response = await fetch(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json'
      }, body: JSON.stringify({ draft: { name: 'Browser Agent', protocol: 'openai-compatible',
        baseUrl, apiKey: 'sk-e2e-browser-secret' }, models: [{ id: 'e2e-tool-model',
        name: 'e2e-tool-model', enabled: true, testState: 'success', imageInputEnabled: false }] }) })
      if (!response.ok || !(await response.json()).ok) throw new Error('Cannot configure E2E model')
    }, provider.baseUrl)
    await page.reload()
    await page.getByLabel('任务描述').fill('打开浏览器并查看测试页面')
    await page.getByLabel('发送').click()
    await expect(page.getByRole('region', { name: '内嵌浏览器' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Agent Target' })).toBeVisible()
    await expect(page.getByTestId('e2e/tasks/detail/browser/address#input'))
      .toHaveValue(provider.browserTargetUrl)
    await page.locator('.activity-archive > summary').click()
    await page.locator('.activity-group > summary').click()
    const browserTool = page.locator('.activity-tool').filter({ hasText: '已操作浏览器：打开内置浏览器' }).first()
    await expect(browserTool.locator('summary')).toContainText('已操作浏览器：打开内置浏览器')
    await browserTool.locator('summary').click()
    await expect(browserTool.locator('.activity-tool-io-title')).toHaveText('Browser Use')
    await expect(browserTool.locator('.activity-tool-code')).toHaveCount(1)
    await expect(browserTool.locator('.activity-tool-code')).toContainText('cua.createBrowserTab("iab"')
    await expect(browserTool.locator('.activity-tool-io')).toContainText('Agent Target')
    await page.reload()
    await page.locator('.activity-archive > summary').click()
    await page.locator('.activity-group > summary').click()
    const restoredBrowserTool = page.locator('.activity-tool').filter({ hasText: '已操作浏览器：打开内置浏览器' }).first()
    await restoredBrowserTool.locator('summary').click()
    await expect(restoredBrowserTool.locator('.activity-tool-code')).toContainText('cua.createBrowserTab("iab"')
    await expect(restoredBrowserTool.locator('.activity-tool-io')).toContainText('Agent Target')
  } finally {
    await application?.close()
    await provider.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})

test('lets the agent open only its isolated Chrome from the CUA JS entry', async () => {
  test.setTimeout(60_000)
  const directory = mkdtempSync(join(tmpdir(), 'ad-browser-agent-chrome-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Agent Chrome Target</title><h1>Chrome target</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server address missing')
  const provider = new FakeOpenAiToolServer('browser-embedded')
  provider.browserTargetBrowserId = 'chrome'
  provider.browserTargetUrl = `http://127.0.0.1:${address.port}/agent`
  await provider.start()
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    application = await electron.launch({ executablePath: await getElectronForkExecutable(),
      args: ['.', `--user-data-dir=${join(directory, 'data')}`], cwd: desktopRoot,
      env: { ...Object.fromEntries(Object.entries(process.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      HOME: directory, ACTIONDRIVER_E2E_HOME_DIRECTORY: directory } })
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await page.evaluate(async (baseUrl) => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const endpoint = new URL(connection.wsUrl)
      endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:'
      endpoint.pathname = '/model-connections'
      const response = await fetch(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${connection.accessToken}`, 'content-type': 'application/json'
      }, body: JSON.stringify({ draft: { name: 'Chrome Agent', protocol: 'openai-compatible',
        baseUrl, apiKey: 'sk-e2e-chrome-secret' }, models: [{ id: 'e2e-tool-model',
        name: 'e2e-tool-model', enabled: true, testState: 'success', imageInputEnabled: false }] }) })
      if (!response.ok || !(await response.json()).ok) throw new Error('Cannot configure E2E model')
    }, provider.baseUrl)
    await page.reload()
    await page.getByLabel('任务描述').fill('使用 Chrome 打开测试页面')
    await page.getByLabel('发送').click()
    await expect(page.getByText('Chrome 已在独立窗口打开')).toBeVisible()
    await page.locator('.activity-archive > summary').click()
    await page.locator('.activity-group > summary').click()
    const browserTool = page.locator('.activity-tool')
      .filter({ hasText: '已操作浏览器：打开独立 Chrome' }).first()
    await browserTool.locator('summary').click()
    await expect(browserTool.locator('.activity-tool-io-title')).toHaveText('Browser Use')
    await expect(browserTool.locator('.activity-tool-code')).toContainText('cua.createBrowserTab("chrome"')
    await expect(browserTool.locator('.activity-tool-io')).toContainText('Agent Chrome Target')
  } finally {
    await application?.close()
    await provider.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
