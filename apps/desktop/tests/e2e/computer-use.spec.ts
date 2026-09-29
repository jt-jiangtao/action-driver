import { getElectronForkExecutable } from './support/electron-fork'
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { FakeOpenAiToolServer } from './support/fake-openai-tool-server'
import { FakeComputerHelper } from './support/fake-computer-helper'

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url))
const apiKey = 'sk-e2e-computer-secret'

let application: ElectronApplication | undefined
let provider: FakeOpenAiToolServer | undefined
let helper: FakeComputerHelper | undefined
let runDirectory: string | undefined

test.afterEach(async () => {
  await application?.close()
  application = undefined
  await provider?.close()
  provider = undefined
  await helper?.close()
  helper = undefined
  if (runDirectory) rmSync(runDirectory, { recursive: true, force: true })
  runDirectory = undefined
})

/**
 * The application resolves the helper socket and token with `os.tmpdir()`, so pointing TMPDIR at
 * this run's directory is what keeps the real (permission-granted) development helper out of the
 * test and lets the fake one serve the app policy that precedes every approval card.
 */
async function launch(mode: 'computer-approval' | 'browser-computer' = 'computer-approval',
  browserTargetUrl = ''): Promise<Page> {
  runDirectory = mkdtempSync(join(tmpdir(), 'ad-cu-'))
  const home = join(runDirectory, 'home')
  mkdirSync(home, { recursive: true })
  helper = new FakeComputerHelper(runDirectory, 'e2e-helper-token')
  await helper.start()
  provider = new FakeOpenAiToolServer(mode)
  provider.browserTargetUrl = browserTargetUrl
  await provider.start()
  application = await electron.launch({ executablePath: await getElectronForkExecutable(),
    args: ['.', `--user-data-dir=${join(runDirectory, 'data')}`],
    cwd: desktopRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: home,
      ACTIONDRIVER_E2E_HOME_DIRECTORY: home,
      TMPDIR: runDirectory
    }
  })
  application.process().stderr?.on('data', (chunk: Buffer) => {
    console.error(`[electron:stderr] ${chunk.toString()}`)
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => console.error(`[renderer:pageerror] ${error.message}`))
  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  await configureProvider(page, provider.baseUrl)
  return page
}

async function configureProvider(page: Page, baseUrl: string): Promise<void> {
  await page.evaluate(
    async ({ baseUrl, secret }) => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const httpUrl = new URL(connection.wsUrl)
      httpUrl.protocol = httpUrl.protocol === 'wss:' ? 'https:' : 'http:'
      httpUrl.pathname = '/model-connections'
      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${connection.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          draft: {
            name: 'E2E Computer Provider',
            protocol: 'openai-compatible',
            baseUrl,
            apiKey: secret
          },
          models: [
            {
              id: 'e2e-tool-model',
              name: 'e2e-tool-model',
              enabled: true,
              testState: 'success',
              imageInputEnabled: false
            }
          ]
        })
      })
      if (!response.ok || !(await response.json()).ok) throw new Error('Cannot configure E2E model')
    },
    { baseUrl, secret: apiKey }
  )
  await page.reload()
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText(
    'E2E Computer Provider / e2e-tool-model'
  )
}

async function sendGoal(page: Page, goal: string): Promise<string> {
  await page.getByLabel('任务描述').fill(goal)
  await page.getByLabel('发送').click()
  const taskPage = page.getByTestId('e2e/tasks/detail/page#page')
  await expect(taskPage).toBeVisible()
  const taskId = await taskPage.getAttribute('data-task-id')
  expect(taskId).toMatch(/^task-/)
  return taskId!
}

test('asks for per-application approval and continues after 仅本次', async () => {
  test.setTimeout(90_000)
  const page = await launch()
  await sendGoal(page, '打开备忘录并告诉我它的状态')

  const card = page.getByRole('region', { name: 'Notes 应用授权' })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('e2e/tasks/detail/computer/app-approval-once#button')).toBeVisible()
  await expect(page.getByTestId('e2e/tasks/detail/computer/app-approval-session#button')).toBeVisible()
  await expect(page.getByTestId('e2e/tasks/detail/computer/app-approval-always#button')).toBeVisible()
  // The policy query is what produced the card, and the decision must reach the runtime.
  expect(helper?.requests.some((request) => request.operation === 'app-policy')).toBe(true)

  await page.getByTestId('e2e/tasks/detail/computer/app-approval-once#button').click()
  await expect(card).toHaveCount(0, { timeout: 60_000 })

  // With the approval settled the cell reaches the helper for the application state.
  await expect
    .poll(() => helper?.requests.filter((request) => request.operation === 'app-state').length ?? 0, {
      timeout: 60_000
    })
    .toBeGreaterThan(0)
})

test('runs browser and computer calls in one CUA JS cell with separate authorization', async () => {
  test.setTimeout(90_000)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>Mixed CUA Target</title><h1>Mixed page</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server address missing')
  try {
    const page = await launch('browser-computer', `http://127.0.0.1:${address.port}/mixed`)
    await sendGoal(page, '查看页面并检查备忘录')
    await expect(page.getByRole('tab', { name: 'Mixed CUA Target' })).toBeVisible()
    const card = page.getByRole('region', { name: 'Notes 应用授权' })
    await expect(card).toBeVisible({ timeout: 60_000 })
    expect(helper?.requests.some((request) => request.operation === 'app-state')).toBe(false)
    await page.getByTestId('e2e/tasks/detail/computer/app-approval-once#button').click()
    await expect(card).toHaveCount(0, { timeout: 60_000 })
    await expect.poll(() => helper?.requests.filter((request) => request.operation === 'app-state').length ?? 0,
      { timeout: 60_000 }).toBeGreaterThan(0)
    await page.locator('.activity-archive > summary').click()
    await page.locator('.activity-group > summary').click()
    const tool = page.locator('.activity-tool').filter({ hasText: '查看网页并操作备忘录' }).first()
    await tool.locator('summary').click()
    await expect(tool.locator('.activity-tool-code')).toContainText('cua.createBrowserTab("iab"')
    await expect(tool.locator('.activity-tool-code')).toContainText('cua.getApp("Notes")')
    await expect(tool.locator('.activity-tool-io')).toContainText('Mixed CUA Target')
    await page.reload()
    await page.locator('.activity-archive > summary').click()
    await page.locator('.activity-group > summary').click()
    const restored = page.locator('.activity-tool')
      .filter({ hasText: '查看网页并操作备忘录' }).first()
    await restored.locator('summary').click()
    await expect(restored.locator('.activity-tool-code')).toContainText('cua.createBrowserTab("iab"')
    await expect(restored.locator('.activity-tool-io')).toContainText('Mixed CUA Target')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
