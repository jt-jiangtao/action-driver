import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import {
  FakeOpenAiStreamServer,
  firstTurnPrompt,
  firstTurnReply,
  secondTurnPrompt
} from './support/fake-openai-stream-server'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const runtimeEntry = fileURLToPath(new URL('../../agent-runtime/dist/index.js', import.meta.url))
const mainBundle = fileURLToPath(new URL('../out/main/index.js', import.meta.url))
const apiKey = 'sk-e2e-stream-secret'

let application: ElectronApplication | undefined
let userDataDirectory: string
let homeDirectory: string
let provider: FakeOpenAiStreamServer

test.beforeAll(async () => {
  expect(existsSync(runtimeEntry)).toBe(true)
  expect(readFileSync(mainBundle, 'utf8')).toContain('ACTIONDRIVER_RUNTIME_DATABASE_PATH')
  provider = new FakeOpenAiStreamServer()
  await provider.start()
})

test.afterAll(async () => {
  await provider.close()
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
})

async function launch(reuseDirectories = false): Promise<Page> {
  if (!reuseDirectories) {
    userDataDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-stream-e2e-data-'))
    homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-stream-e2e-home-'))
  }
  application = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: homeDirectory,
      ACTIONDRIVER_E2E_HOME_DIRECTORY: homeDirectory
    }
  })
  const page = await application.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[renderer:${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => console.error(`[renderer:pageerror] ${error.message}`))
  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  return page
}

async function configureProvider(page: Page): Promise<void> {
  await page.evaluate(
    async ({ baseUrl, secret }) => {
      await window.actionDriverDesktop.modelConnections.add(
        {
          name: 'E2E Stream Provider',
          protocol: 'openai-compatible',
          baseUrl,
          apiKey: secret
        },
        [
          {
            id: 'e2e-stream-model',
            name: 'e2e-stream-model',
            enabled: true,
            testState: 'success'
          }
        ]
      )
    },
    { baseUrl: provider.baseUrl, secret: apiKey }
  )
  await page.reload()
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText(
    'E2E Stream Provider / e2e-stream-model'
  )
}

function readInteractionFiles(directory: string): string {
  if (!existsSync(directory)) return ''
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) return readInteractionFiles(path)
      const contents = readFileSync(path)
      return path.endsWith('.gz')
        ? gunzipSync(contents).toString('utf8')
        : contents.toString('utf8')
    })
    .join('\n')
}

test('streams two real turns in one persisted session with aggregate model logs', async () => {
  let page = await launch()
  await configureProvider(page)

  await page.getByLabel('任务描述').fill(firstTurnPrompt)
  await page.getByLabel('发送').click()
  const taskPage = page.getByTestId('e2e/tasks/detail/page#page')
  await expect(taskPage).toBeVisible()
  const firstTaskId = await taskPage.getAttribute('data-task-id')
  expect(firstTaskId).toMatch(/^task-/)
  await expect(page.getByTestId('e2e/tasks/detail/browser#section')).toHaveCount(0)

  const markdown = page.getByTestId('e2e/tasks/detail/markdown#section').last()
  const composer = page.getByTestId('e2e/shared/composer/root#section')
  const editor = page.getByLabel('任务描述')
  await expect(page.getByRole('heading', { name: '第一轮结果' })).toBeVisible({ timeout: 10_000 })
  await expect(markdown).not.toContainText('Beta')
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  const composerWhileStreaming = await composer.boundingBox()
  expect(composerWhileStreaming).not.toBeNull()
  await expect(markdown.getByRole('listitem')).toHaveCount(2)
  await expect(markdown).toContainText('Beta')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  const composerAfterFirstTurn = await composer.boundingBox()
  expect(composerAfterFirstTurn).not.toBeNull()
  expect(Math.abs(composerAfterFirstTurn!.y - composerWhileStreaming!.y)).toBeLessThan(2)

  expect(provider.completions).toHaveLength(1)
  expect(provider.completions[0]).toMatchObject({
    model: 'e2e-stream-model',
    stream: true,
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: firstTurnPrompt })
    ])
  })

  await editor.fill(secondTurnPrompt)
  await page.getByLabel('发送').click()
  await expect.poll(() => taskPage.getAttribute('data-task-id')).not.toBe(firstTaskId)
  const secondTaskId = await taskPage.getAttribute('data-task-id')
  expect(secondTaskId).toMatch(/^task-/)
  await expect(page.getByRole('heading', { name: '第二轮结果' })).toBeVisible({ timeout: 10_000 })
  await expect(markdown).toContainText('Alpha 与 Beta 已汇总完成。')
  await expect(editor).toHaveAttribute('contenteditable', 'true')

  expect(provider.completions).toHaveLength(2)
  expect(provider.completions[1]?.model).toBe(provider.completions[0]?.model)
  expect(provider.completions[1]?.messages.filter(({ role }) => role !== 'system')).toEqual([
    { role: 'user', content: firstTurnPrompt },
    { role: 'assistant', content: firstTurnReply },
    { role: 'user', content: secondTurnPrompt }
  ])

  const persistedTasks = await page.evaluate(
    async ([firstId, secondId]) =>
      Promise.all([
        window.actionDriverDesktop.agent.get(firstId),
        window.actionDriverDesktop.agent.get(secondId)
      ]),
    [firstTaskId!, secondTaskId!] as const
  )
  expect(persistedTasks[0]?.sessionId).toBe(persistedTasks[1]?.sessionId)
  expect(persistedTasks[0]?.model).toEqual(persistedTasks[1]?.model)
  await expect(page.locator('[data-testid^="e2e/shared/sidebar/tasks/"]')).toHaveCount(1)

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const sessions = await window.actionDriverDesktop.agent.listModelLogs()
          return sessions.map((session) => ({
            sessionId: session.sessionId,
            tasks: session.tasks.map((task) => ({
              id: task.id,
              calls: task.calls.map((call) => call.status)
            }))
          }))
        }),
      { timeout: 10_000 }
    )
    .toEqual([
      {
        sessionId: persistedTasks[0]?.sessionId,
        tasks: [
          { id: firstTaskId, calls: ['completed'] },
          { id: secondTaskId, calls: ['completed'] }
        ]
      }
    ])

  await page.getByTestId('e2e/shared/sidebar/settings#button').click()
  await page.getByTestId('e2e/settings/sidebar/logs#button').click()
  await page.getByTestId('e2e/settings/logs/layer/model#button').click()
  await expect(page.getByText(firstTurnPrompt, { exact: true })).toBeVisible()
  await page.getByTestId('e2e/settings/logs/model/view/tasks#button').click()
  const realTaskCards = page.locator('[data-testid^="e2e/settings/logs/model/task-cards/"]')
  await expect(realTaskCards).toHaveCount(2)
  await expect(realTaskCards.nth(0)).toContainText(firstTurnPrompt)
  await expect(realTaskCards.nth(1)).toContainText(secondTurnPrompt)

  await application!.close()
  application = undefined
  page = await launch(true)
  const recentSession = page.locator('[data-testid^="e2e/shared/sidebar/tasks/"]')
  await expect(recentSession).toHaveCount(1)
  await expect(recentSession).toContainText(firstTurnPrompt)
  await recentSession.click()
  const restoredUserMessages = page.locator('.conversation-stream .user-message')
  const restoredAgentMessages = page.locator('.conversation-stream .agent-message')
  await expect(restoredUserMessages).toHaveCount(2)
  await expect(restoredUserMessages.nth(0)).toHaveText(firstTurnPrompt)
  await expect(restoredUserMessages.nth(1)).toHaveText(secondTurnPrompt)
  await expect(restoredAgentMessages).toHaveCount(2)
  await expect(page.getByRole('heading', { name: '第一轮结果' })).toBeVisible()
  await expect(page.getByText('Beta', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '第二轮结果' })).toBeVisible()
  await expect(page.getByText('Alpha 与 Beta 已汇总完成。', { exact: true })).toBeVisible()

  await application!.close()
  application = undefined
  const interactionText = readInteractionFiles(join(userDataDirectory, 'logs', 'interactions'))
  expect(interactionText).not.toContain(apiKey)
  expect(interactionText).not.toContain('"type":"auth"')
  expect(interactionText).not.toContain('actiondriver:log:list')
  expect(interactionText).not.toContain('response.content')
  expect(interactionText.match(/POST \/chat\/completions/g)).toHaveLength(4)
})
