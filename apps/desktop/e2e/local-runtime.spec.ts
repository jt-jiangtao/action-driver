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
import { FakeOpenAiStreamServer } from './support/fake-openai-stream-server'

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

test('streams one real local Agent task, persists it, and exposes one aggregate model log', async () => {
  let page = await launch()
  await configureProvider(page)

  await page.getByLabel('任务描述').fill('返回 Markdown 流式结果')
  await page.getByLabel('发送').click()
  const taskPage = page.getByTestId('e2e/tasks/detail/page#page')
  await expect(taskPage).toBeVisible()
  const taskId = await taskPage.getAttribute('data-task-id')
  expect(taskId).toMatch(/^task-/)
  await expect(page.getByTestId('e2e/tasks/detail/browser#section')).toHaveCount(0)

  const markdown = page.getByTestId('e2e/tasks/detail/markdown#section')
  await expect(markdown).toContainText('流式', { timeout: 10_000 })
  await expect(page.getByRole('heading', { name: '流式结果' })).toBeVisible()
  await expect(markdown.getByRole('listitem')).toHaveCount(2)
  await expect(markdown).toContainText('流式完成')

  expect(provider.completions).toHaveLength(1)
  expect(provider.completions[0]).toMatchObject({
    model: 'e2e-stream-model',
    stream: true,
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '返回 Markdown 流式结果' })
    ])
  })

  await expect
    .poll(
      async () => {
        const modelLog = await page.evaluate(
          (id) => window.actionDriverDesktop.agent.getModelLog(id),
          taskId!
        )
        return modelLog?.tasks[0]?.calls[0] ?? null
      },
      { timeout: 10_000 }
    )
    .toMatchObject({
      status: 'completed',
      requestId: `plan:${taskId}`,
      sections: expect.arrayContaining([
        expect.objectContaining({
          id: 'model-response',
          content: expect.stringContaining('流式完成')
        })
      ])
    })

  await application!.close()
  application = undefined
  page = await launch(true)
  await expect(page.getByRole('button', { name: '返回 Markdown 流式结果' })).toBeVisible()
  const persisted = await page.evaluate((id) => window.actionDriverDesktop.agent.get(id), taskId!)
  expect(persisted).toMatchObject({ status: 'succeeded' })
  expect(persisted?.messages.find((message) => message.role === 'agent')?.content).toContain(
    '流式完成'
  )

  await application!.close()
  application = undefined
  const interactionText = readInteractionFiles(join(userDataDirectory, 'logs', 'interactions'))
  expect(interactionText).not.toContain(apiKey)
  expect(interactionText).not.toContain('actiondriver:log:list')
  expect(interactionText.match(/POST \/chat\/completions/g)).toHaveLength(2)
})
