import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeOpenAiToolServer, FakeSearxngServer } from './support/fake-openai-tool-server'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const runtimeEntry = fileURLToPath(new URL('../../agent-runtime/dist/index.js', import.meta.url))
const mainBundle = fileURLToPath(new URL('../out/main/index.js', import.meta.url))
const apiKey = 'sk-e2e-tool-secret'

let application: ElectronApplication | undefined
let provider: FakeOpenAiToolServer | undefined
let search: FakeSearxngServer | undefined
let userDataDirectory: string
let homeDirectory: string

test.beforeAll(() => {
  expect(existsSync(runtimeEntry)).toBe(true)
  expect(existsSync(mainBundle)).toBe(true)
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
  await provider?.close()
  provider = undefined
  await search?.close()
  search = undefined
  if (userDataDirectory) rmSync(userDataDirectory, { recursive: true, force: true })
  if (homeDirectory) rmSync(homeDirectory, { recursive: true, force: true })
})

async function launch(
  mode: 'activity' | 'read' | 'shell' | 'shell-timeout' | 'web'
): Promise<Page> {
  provider = new FakeOpenAiToolServer(mode)
  await provider.start()
  if (mode === 'web') {
    search = new FakeSearxngServer()
    await search.start()
  }
  userDataDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-tool-e2e-data-'))
  homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-tool-e2e-home-'))
  const workspace = join(userDataDirectory, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'README.md'), '# E2E workspace\n\nneedle is present.\n')
  if (mode === 'shell-timeout') execFileSync('mkfifo', [join(workspace, 'BLOCKING_FIFO')])
  application = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: homeDirectory,
      ACTIONDRIVER_E2E_HOME_DIRECTORY: homeDirectory,
      ...(search ? { ACTIONDRIVER_SEARXNG_ENDPOINT: search.endpoint } : {})
    }
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => console.error(`[renderer:pageerror] ${error.message}`))
  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  await page.evaluate(
    async ({ baseUrl, secret }) => {
      await window.actionDriverDesktop.modelConnections.add(
        {
          name: 'E2E Tool Provider',
          protocol: 'openai-compatible',
          baseUrl,
          apiKey: secret
        },
        [{ id: 'e2e-tool-model', name: 'e2e-tool-model', enabled: true, testState: 'success' }]
      )
    },
    { baseUrl: provider.baseUrl, secret: apiKey }
  )
  await page.reload()
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText(
    'E2E Tool Provider / e2e-tool-model'
  )
  return page
}

test('requires approval for local SearXNG, records only normalized results, then returns final Markdown', async () => {
  const page = await launch('web')
  await sendGoal(page, '搜索 ActionDriver')
  await expect(page.getByRole('region', { name: '任务过程' })).toBeVisible({
    timeout: 15_000
  })
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toBeVisible({
    timeout: 15_000
  })
  expect(search!.requests).toEqual([])
  expect(provider!.completions).toHaveLength(1)
  expect(provider!.completions[0]?.tools?.map((tool) => tool.function?.name)).toContain(
    'web_search'
  )

  await page.getByTestId('e2e/tasks/detail/activity/approve#button').click()
  await expect(page.getByRole('heading', { name: '搜索完成' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('e2e/tasks/detail/activity/archive#button')).toBeVisible()
  await expect(page.getByRole('region', { name: '任务过程' })).not.toContainText(
    'searxng-raw-response-must-not-be-recorded'
  )
  expect(search!.requests).toEqual(['/search?q=ActionDriver&format=json'])
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain(
    'normalized searchable summary'
  )
  expect(JSON.stringify(provider!.completions[1]?.messages)).not.toContain(
    'searxng-raw-response-must-not-be-recorded'
  )
  const markdown = page.getByTestId('e2e/tasks/detail/markdown#section').last()
  await expect(markdown).not.toContainText('正在搜索')
  const records = await page.evaluate(
    async () => (await window.actionDriverDesktop.logs.list({ limit: 100 })).records
  )
  const record = records.find((item) => item.operation === 'web.search')
  expect(record).toBeDefined()
  const detail = await page.evaluate(
    async (id) => window.actionDriverDesktop.logs.detail(id),
    record!.id
  )
  expect(JSON.stringify(detail)).toContain('normalized searchable summary')
  expect(JSON.stringify(detail)).not.toContain('searxng-raw-response-must-not-be-recorded')
  expect(JSON.stringify(detail)).not.toContain(apiKey)
})

test('rejects local SearXNG without making a search request', async () => {
  const page = await launch('web')
  await sendGoal(page, '搜索 ActionDriver')
  await expect(page.getByTestId('e2e/tasks/detail/activity/reject#button')).toBeVisible({
    timeout: 15_000
  })
  await page.getByTestId('e2e/tasks/detail/activity/reject#button').click()
  await expect(page.getByRole('heading', { name: '已拒绝' })).toBeVisible({ timeout: 15_000 })
  expect(search!.requests).toEqual([])
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('TOOL_REJECTED')
})

async function sendGoal(page: Page, goal: string): Promise<string> {
  await page.getByLabel('任务描述').fill(goal)
  await page.getByLabel('发送').click()
  const taskPage = page.getByTestId('e2e/tasks/detail/page#page')
  await expect(taskPage).toBeVisible()
  const taskId = await taskPage.getAttribute('data-task-id')
  expect(taskId).toMatch(/^task-/)
  return taskId!
}

test('runs a real workspace read through WebSocket and returns only final Markdown', async () => {
  const page = await launch('read')
  const taskId = await sendGoal(page, '读取 README 的第一段')
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('e2e/tasks/detail/browser#section')).toHaveCount(0)
  await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
    'data-state',
    'idle'
  )
  await expect.poll(() => provider!.completions.length).toBe(2)
  const [first, second] = provider!.completions
  expect(first?.tools?.map((tool) => tool.function?.name)).toContain('sandbox_fs_read')
  expect(first?.tool_choice).toBe('auto')
  expect(second?.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'provider-tool-1',
      name: 'sandbox_fs_read'
    })
  )
  expect(JSON.stringify(second?.messages)).toContain('E2E workspace')
  const markdown = page.getByTestId('e2e/tasks/detail/markdown#section').last()
  await expect(markdown).not.toContainText('正在读取')
  await expect(markdown).not.toContainText('执行中')
  const composer = await page.getByTestId('e2e/shared/composer/root#section').boundingBox()
  const body = await page.locator('.conversation-body').boundingBox()
  expect(composer).not.toBeNull()
  expect(body).not.toBeNull()
  expect(body!.y + body!.height - (composer!.y + composer!.height)).toBeLessThan(32)

  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const session = await window.actionDriverDesktop.agent.getModelLog(id)
        return session?.tasks.flatMap((task) => task.calls).length ?? 0
      }, taskId)
    )
    .toBe(2)
  const modelCalls = await page.evaluate(
    async (id) =>
      (await window.actionDriverDesktop.agent.getModelLog(id))?.tasks.flatMap((task) => task.calls),
    taskId
  )
  expect(modelCalls).toHaveLength(2)
  expect(
    modelCalls?.every((call) => call.sections.some((section) => section.id === 'model-request'))
  ).toBe(true)
  expect(
    modelCalls?.every((call) => call.sections.some((section) => section.id === 'model-response'))
  ).toBe(true)
  const records = await page.evaluate(
    async () => (await window.actionDriverDesktop.logs.list({ limit: 100 })).records
  )
  const toolRecords = records.filter((record) => record.operation === 'sandbox.fs.read')
  expect(toolRecords).toHaveLength(1)
  const toolDetail = await page.evaluate(
    async (eventId) => window.actionDriverDesktop.logs.detail(eventId),
    toolRecords[0]!.id
  )
  expect(toolDetail.request?.text).toContain('README.md')
  expect(toolDetail.response?.text).toContain('E2E workspace')
  expect(records.some((record) => record.operation === 'actiondriver:log:list')).toBe(false)

  await page.reload()
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) => (await window.actionDriverDesktop.agent.get(id))?.messages.at(-1)?.content,
        taskId
      )
    )
    .toContain('已读取')
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.actionDriverDesktop.agent.getModelLog(id))?.tasks.flatMap(
            (task) => task.calls
          ).length,
        taskId
      )
    )
    .toBe(2)
  await expect
    .poll(async () =>
      page.evaluate(
        async (id) =>
          (await window.actionDriverDesktop.logs.list({ limit: 100 })).records.filter(
            (record) => record.taskId === id && record.operation === 'sandbox.fs.read'
          ).length,
        taskId
      )
    )
    .toBe(1)
})

test('keeps interleaved process and tool calls ordered live and after reopening', async () => {
  const page = await launch('activity')
  const taskId = await sendGoal(page, '调研 README')
  const archive = page.getByTestId('e2e/tasks/detail/activity/archive#button')
  await expect(archive).toBeVisible({ timeout: 15_000 })
  await expect(archive).toContainText('用时')
  const archiveDetails = archive.locator('..')
  await expect(archiveDetails).not.toHaveAttribute('open', '')
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible()
  await archive.click()
  const group = page.locator('.activity-group')
  await expect(group).toHaveCount(1)
  await group.locator('summary').first().click()
  const items = group.locator('.activity-items > *')
  await expect(items).toHaveCount(4)
  const live = await items.allTextContents()
  expect(live[0]).toContain('正文 A')
  expect(live[1]).toContain('README')
  expect(live[2]).toContain('正文 B')
  expect(live[3]).toContain('README')
  await expect(page.getByTestId('e2e/tasks/detail/activity/raw-io#button')).toHaveCount(2)
  await page.getByTestId('e2e/tasks/detail/activity/raw-io#button').first().click()
  await expect(group).toContainText('README.md')
  expect(provider!.completions).toHaveLength(3)
  expect(provider!.completions[0]?.tools?.map((tool) => tool.function?.name)).not.toContain(
    'activity_update'
  )

  await page.reload()
  await page.getByTestId(`e2e/shared/sidebar/tasks/${taskId}#button`).click()
  await expect(page.getByTestId('e2e/tasks/detail/activity/archive#button')).toBeVisible()
  await page.getByTestId('e2e/tasks/detail/activity/archive#button').click()
  const restoredGroup = page.locator('.activity-group')
  await restoredGroup.locator('summary').first().click()
  const restoredItems = restoredGroup.locator('.activity-items > *')
  await expect(restoredItems).toHaveCount(4)
  expect(await restoredItems.allTextContents()).toEqual(live)
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible()
})

test('waits for one-time shell approval before executing and answering', async () => {
  const page = await launch('shell')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sendGoal(page, '在 README 中查找 needle')
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toBeVisible({
    timeout: 15_000
  })
  await expect(page.locator('.activity-active-title').first()).toBeVisible()
  expect(
    await page
      .locator('.activity-active-title')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName)
  ).toBe('none')
  expect(provider!.completions).toHaveLength(1)
  expect(
    await page.evaluate(async () =>
      (await window.actionDriverDesktop.logs.list({ limit: 100 })).records
        .filter((record) => record.operation === 'sandbox.shell.run')
        .map((record) => ({ state: record.state, responseAvailable: record.responseAvailable }))
    )
  ).toEqual([{ state: 'pending', responseAvailable: false }])
  await page.getByTestId('e2e/tasks/detail/activity/approve#button').click()
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => provider!.completions.length).toBe(2)
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('needle is present')
  expect(
    await page.evaluate(async () =>
      (await window.actionDriverDesktop.logs.list({ limit: 100 })).records.filter(
        (record) => record.operation === 'sandbox.shell.run' && record.outcome === 'ok'
      )
    )
  ).toHaveLength(1)
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
})

test('rejects a shell call without running the command', async () => {
  const page = await launch('shell')
  await sendGoal(page, '在 README 中查找 needle')
  await expect(page.getByTestId('e2e/tasks/detail/activity/reject#button')).toBeVisible({
    timeout: 15_000
  })
  await page.getByTestId('e2e/tasks/detail/activity/reject#button').click()
  await expect(page.getByRole('heading', { name: '已拒绝' })).toBeVisible({ timeout: 15_000 })
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('TOOL_REJECTED')
  expect(JSON.stringify(provider!.completions[1]?.messages)).not.toContain('needle is present')
})

test('times out an approved shell process and reports the terminal error', async () => {
  test.skip(process.platform === 'win32', 'This POSIX test uses a named pipe')
  test.setTimeout(30_000)
  const page = await launch('shell-timeout')
  await sendGoal(page, '在阻塞文件中查找 needle')
  const approve = page.getByTestId('e2e/tasks/detail/activity/approve#button')
  await expect(approve).toBeVisible({ timeout: 15_000 })
  await approve.click()
  await expect(page.getByRole('heading', { name: '已超时' })).toBeVisible({ timeout: 20_000 })
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('TOOL_TIMEOUT')
  expect(JSON.stringify(provider!.completions[1]?.messages)).not.toContain('needle is present')
  expect(
    await page.evaluate(async () =>
      (await window.actionDriverDesktop.logs.list({ limit: 100 })).records
        .filter((record) => record.operation === 'sandbox.shell.run')
        .map((record) => record.outcome)
    )
  ).toEqual(['error'])
})

test('cancels a shell call while approval is pending', async () => {
  const page = await launch('shell')
  const taskId = await sendGoal(page, '在 README 中查找 needle')
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toBeVisible({
    timeout: 15_000
  })
  await page.getByLabel('中断任务').click()
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
  await expect
    .poll(async () =>
      page.evaluate(async (id) => (await window.actionDriverDesktop.agent.get(id))?.status, taskId)
    )
    .toBe('paused')
  expect(provider!.completions).toHaveLength(1)
})

test('keeps a pending approval actionable after WebSocket reconnect', async () => {
  const page = await launch('shell')
  await page.evaluate(() => {
    const NativeWebSocket = window.WebSocket
    const target = window as Window & { toolTestSockets?: WebSocket[] }
    target.toolTestSockets = []
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        target.toolTestSockets!.push(this)
      }
    }
  })
  await sendGoal(page, '在 README 中查找 needle')
  const approve = page.getByTestId('e2e/tasks/detail/activity/approve#button')
  await expect(approve).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => {
    const target = window as Window & { toolTestSockets?: WebSocket[] }
    target.toolTestSockets?.[0]?.close(3001, 'test reconnect')
  })
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const target = window as Window & { toolTestSockets?: WebSocket[] }
        return target.toolTestSockets?.length ?? 0
      })
    )
    .toBe(2)
  await expect(approve).toBeVisible()
  await approve.click()
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
  expect(provider!.completions).toHaveLength(2)
})
