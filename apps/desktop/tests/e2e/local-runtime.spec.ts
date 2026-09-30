import { getElectronForkExecutable } from './support/electron-fork'
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import {
  FakeOpenAiStreamServer,
  firstTurnPrompt,
  firstTurnReply,
  secondTurnPrompt
} from './support/fake-openai-stream-server'

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url))
const runtimeEntry = fileURLToPath(new URL('../../../local-runtime/dist/index.js', import.meta.url))
const mainBundle = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const apiKey = 'sk-e2e-stream-secret'

let application: ElectronApplication | undefined
let userDataDirectory: string
let homeDirectory: string
let provider: FakeOpenAiStreamServer

test.beforeAll(async () => {
  expect(existsSync(runtimeEntry)).toBe(true)
  expect(readFileSync(mainBundle, 'utf8')).toContain('ACTION_DRIVER_RUNTIME_DATA_ROOT')
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

async function launch(
  reuseDirectories = false,
  environment: NodeJS.ProcessEnv = {}
): Promise<Page> {
  if (!reuseDirectories) {
    userDataDirectory = mkdtempSync(join(tmpdir(), 'action-driver-stream-e2e-data-'))
    homeDirectory = mkdtempSync(join(tmpdir(), 'action-driver-stream-e2e-home-'))
  }
  application = await electron.launch({
    executablePath: await getElectronForkExecutable(),
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: homeDirectory,
      ACTION_DRIVER_E2E_HOME_DIRECTORY: homeDirectory,
      ...Object.fromEntries(
        Object.entries(environment).filter((entry): entry is [string, string] => Boolean(entry[1]))
      )
    }
  })
  application.process().stderr?.on('data', (chunk: Buffer) => {
    console.error(`[electron:stderr] ${chunk.toString()}`)
  })
  const page = await application.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[renderer:${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => console.error(`[renderer:pageerror] ${error.message}`))
  await expect(page.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
  return page
}

async function configureProvider(page: Page): Promise<void> {
  await page.evaluate(
    async ({ baseUrl, secret }) => {
      const connection = await window.productDesktop.runtimeConnection.get()
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
            name: 'E2E Stream Provider',
            protocol: 'openai-compatible',
            baseUrl,
            apiKey: secret
          },
          models: [
            {
              id: 'e2e-stream-model',
              name: 'e2e-stream-model',
              enabled: true,
              testState: 'success',
              imageInputEnabled: true
            }
          ]
        })
      })
      if (!response.ok || !(await response.json()).ok) throw new Error('Cannot configure E2E model')
    },
    { baseUrl: provider.baseUrl, secret: apiKey }
  )
  await page.reload()
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText(
    'E2E Stream Provider / e2e-stream-model'
  )
}

test('packaged Renderer reaches the Runtime HTTP API with its exact origin and token', async () => {
  const page = await launch()
  expect(page.url()).toBe('action-driver://renderer/index.html')
  expect(await page.evaluate(() => window.location.origin)).toBe('action-driver://renderer')
  expect(await page.evaluate(() => Object.keys(window.productDesktop).sort())).toEqual([
    'browserSession',
    'computerUse',
    'externalLinks',
    'getEnvironment',
    'runtimeConnection',
    'skillFolders',
    'taskOutput'
  ])
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith('/model-connections')
  )
  const result = await page.evaluate(async () => {
    const connection = await window.productDesktop.runtimeConnection.get()
    const httpUrl = new URL(connection.wsUrl)
    httpUrl.protocol = httpUrl.protocol === 'wss:' ? 'https:' : 'http:'
    httpUrl.pathname = '/model-connections'
    const response = await fetch(httpUrl, {
      headers: { authorization: `Bearer ${connection.accessToken}` }
    })
    return { status: response.status }
  })
  expect(await (await requestPromise).headerValue('origin')).toBe('action-driver://renderer')
  expect(result).toEqual({ status: 200 })
})

test('opens the native guidance window only when a permission is missing', async () => {
  const page = await launch()
  const { status, opened } = await page.evaluate(async () => {
    const api = window.productDesktop.computerUse
    return { status: await api.permissions(), opened: await api.ensureGuidance() }
  })
  expect(opened).toBe(!status.accessibility || !status.screenRecording)
  // The guidance window is native and lives in the helper process, so Electron still owns exactly
  // one window; its presence and behaviour are covered by the helper tests and the packaged smoke.
  expect(
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  ).toBe(1)
})

test('keeps an unverified Token Plan image model unavailable after restart', async () => {
  let page = await launch()
  await page.evaluate(async () => {
    const connection = await window.productDesktop.runtimeConnection.get()
    const url = new URL(connection.wsUrl)
    url.protocol = 'http:'
    url.pathname = '/model-connections'
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        draft: {
          name: 'Token Plan E2E',
          protocol: 'openai-compatible',
          baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
          apiKey: 'sk-e2e-token-plan'
        },
        models: [
          {
            id: 'wan2.7-image',
            name: 'wan2.7-image',
            enabled: true,
            testState: 'success',
            imageGenerationEnabled: true,
            imageGenerationApi: 'token-plan',
            capabilities: { image_generation: { state: 'success', source: 'probe' } }
          }
        ]
      })
    })
    if (!response.ok || !(await response.json()).ok)
      throw new Error('Cannot configure Token Plan model')
  })
  await page.reload()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByText('Token Plan E2E')).toBeVisible()
  await expect(page.getByText('生图 · 待测试')).toBeVisible()
  await expect(page.getByRole('button', { name: '设为默认生图模型：wan2.7-image' })).toHaveCount(0)
  await application!.close()
  application = undefined
  page = await launch(true)
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByText('生图 · 待测试')).toBeVisible()
  await expect(page.getByRole('button', { name: '设为默认生图模型：wan2.7-image' })).toHaveCount(0)
})

test('saves the main prompt through Runtime and lists enabled system Skills', async () => {
  const page = await launch()
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByTestId('e2e/settings/sidebar/main-prompt#button').click()
  await expect(page.getByTestId('e2e/settings/main-prompt/page#page')).toBeVisible()
  await page.getByTestId('e2e/settings/agent-editors/main-prompt/mode/source#button').click()
  const editor = page.getByRole('textbox', { name: '主提示词 Markdown 源码' })
  await editor.focus()
  await page.keyboard.press('Meta+A')
  await page.keyboard.insertText('# Runtime 持有的提示词\n')
  await page.getByTestId('e2e/settings/agent-editors/main-prompt/save#button').click()
  await expect(
    page.getByTestId('e2e/settings/agent-editors/main-prompt/save#button')
  ).toBeDisabled()
  await page.reload()
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByTestId('e2e/settings/sidebar/main-prompt#button').click()
  await expect(page.getByTestId('e2e/settings/main-prompt/page#page')).toContainText(
    'Runtime 持有的提示词'
  )
  await page.getByTestId('e2e/settings/sidebar/skills#button').click()
  await expect(page.getByTestId('e2e/settings/skills/page#page')).toBeVisible()
  for (const id of ['documents', 'pdf', 'skill-creator']) {
    await expect(page.getByTestId(`e2e/settings/skills/items/${id}#button`)).toBeVisible()
    await expect(page.getByTestId(`e2e/settings/skills/toggles/${id}#switch`)).toHaveAttribute(
      'aria-checked',
      'true'
    )
  }
})

test('installs a local instruction Skill into the desktop list and keeps its source on uninstall', async () => {
  const page = await launch()
  const source = join(homeDirectory, 'incoming', 'e2e-notes')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'SKILL.md'), '# E2E Notes\n\nWrite concise notes.\n')
  const installed = await page.evaluate(async (path) => {
    const connection = await window.productDesktop.runtimeConnection.get()
    const url = new URL(connection.wsUrl)
    url.protocol = 'http:'
    url.pathname = '/agent-files/skills/install'
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ source: 'local', path })
    })
    return response.json() as Promise<{ ok: boolean; value?: { id: string; source: string } }>
  }, source)
  expect(installed).toMatchObject({ ok: true, value: { id: 'e2e-notes', source: 'local' } })
  await application?.close()
  application = undefined
  const reopened = await launch(true)
  await reopened.getByRole('button', { name: '设置' }).click()
  await reopened.getByTestId('e2e/settings/sidebar/skills#button').click()
  await expect(reopened.getByTestId('e2e/settings/skills/items/e2e-notes#button')).toBeVisible()
  await reopened.getByTestId('e2e/settings/skills/items/e2e-notes#button').click()
  await expect(reopened.getByRole('dialog', { name: 'E2E Notes' })).toContainText(
    'Write concise notes.'
  )
  await reopened.getByTestId('e2e/settings/skills/detail/uninstall#button').click()
  await reopened.getByTestId('e2e/settings/skills/dialog/submit#button').click()
  await expect(reopened.getByTestId('e2e/settings/skills/items/e2e-notes#button')).toHaveCount(0)
  expect(existsSync(join(source, 'SKILL.md'))).toBe(true)
})

test('installs a GitHub Skill through existing Git configuration and updates the desktop state', async () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'action-driver-github-e2e-'))
  const repo = join(fixtureRoot, 'private-repo')
  const config = join(fixtureRoot, 'gitconfig')
  mkdirSync(join(repo, 'skills', 'e2e-github'), { recursive: true })
  writeFileSync(
    join(repo, 'skills', 'e2e-github', 'SKILL.md'),
    '# E2E GitHub\n\nReview local changes.\n'
  )
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'add', '.'])
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'fixture'
  ])
  const branch = execFileSync('git', ['-C', repo, 'branch', '--show-current'], {
    encoding: 'utf8'
  }).trim()
  writeFileSync(
    config,
    `[url "file://${repo}"]\n\tinsteadOf = https://github.com/acme/private.git\n`
  )
  const page = await launch(false, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' })
  const installed = await page.evaluate(async (urlValue) => {
    const connection = await window.productDesktop.runtimeConnection.get()
    const url = new URL(connection.wsUrl)
    url.protocol = 'http:'
    url.pathname = '/agent-files/skills/install'
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ source: 'github', url: urlValue })
    })
    return response.json() as Promise<{ ok: boolean; value?: { id: string; source: string } }>
  }, `https://github.com/acme/private.git/tree/${branch}/skills/e2e-github`)
  expect(installed).toMatchObject({ ok: true, value: { id: 'e2e-github', source: 'github' } })
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByTestId('e2e/settings/sidebar/skills#button').click()
  const row = page.getByTestId('e2e/settings/skills/items/e2e-github#button').locator('..')
  await expect(row.locator('.skill-source')).toHaveText('GitHub')
  await row.getByRole('switch').click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await row.getByRole('switch').click()
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await row.getByRole('button', { name: /E2E GitHub/ }).click()
  await expect(page.getByRole('dialog', { name: 'E2E GitHub' })).toContainText(
    'Review local changes.'
  )
})

test('streams two real turns in one persisted session without local logs', async () => {
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
  await expect(markdown.getByRole('listitem')).toHaveCount(2)
  await expect(markdown).toContainText('Beta')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  expect(await composer.boundingBox()).not.toBeNull()

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
    async ([firstId, secondId]) => {
      const connection = await window.productDesktop.runtimeConnection.get()
      const baseUrl = new URL(connection.wsUrl)
      baseUrl.protocol = baseUrl.protocol === 'wss:' ? 'https:' : 'http:'
      return Promise.all(
        [firstId, secondId].map(async (taskId) => {
          const url = new URL(`/tasks/${encodeURIComponent(taskId)}`, baseUrl)
          const response = await fetch(url, {
            headers: { authorization: `Bearer ${connection.accessToken}` }
          })
          return (await response.json()).value.task
        })
      )
    },
    [firstTaskId!, secondTaskId!] as const
  )
  expect(persistedTasks[0]?.sessionId).toBe(persistedTasks[1]?.sessionId)
  expect(persistedTasks[0]?.model).toEqual(persistedTasks[1]?.model)
  await expect(page.locator('[data-testid^="e2e/shared/sidebar/tasks/"]')).toHaveCount(1)

  await page.getByTestId('e2e/shared/sidebar/settings#button').click()
  await expect(page.getByTestId('e2e/settings/sidebar/logs#button')).toHaveCount(0)
  await expect(page.getByText(firstTurnPrompt, { exact: true })).toHaveCount(0)

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
  expect(existsSync(join(userDataDirectory, 'logs'))).toBe(false)
})

test('keeps a wide uploaded image visible in the composer, sent message, and restored session', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron uses Chromium')
  let page = await launch()
  await configureProvider(page)
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 600
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#111'
    context.font = 'bold 110px sans-serif'
    context.fillText('WIDE IMAGE TEST', 80, 320)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await page.getByLabel('添加图片').setInputFiles({
    name: 'wide-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64')
  })
  const preview = page.locator('.composer-image-preview')
  await expect(preview.getByRole('img', { name: 'wide-image.png' })).toBeVisible()
  await expect(preview.getByText('wide-image.png')).toBeVisible()
  await expect(preview.getByRole('button', { name: '移除 wide-image.png' })).toBeVisible()
  await preview.getByRole('button', { name: '放大 wide-image.png' }).click()
  await expect(page.locator('.image-preview img[alt="wide-image.png"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'rotateRight' })).toBeVisible()
  await page.getByTestId('e2e/shared/composer/images/preview-close#button').click()
  await expect(page.locator('.image-preview')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('wide-image-composer.png') })
  await page.getByLabel('任务描述').fill('请描述这张图片')
  await page.getByLabel('发送').click()
  const userImage = page.locator('.conversation-stream .user-message img[alt="上传的图片"]')
  await expect(userImage).toBeVisible({ timeout: 10_000 })
  await expect(userImage).toHaveJSProperty('naturalWidth', 1600)
  await page.screenshot({ path: testInfo.outputPath('wide-image-message.png') })
  await expect(page.getByRole('heading', { name: '未知请求' })).toBeVisible({ timeout: 10_000 })
  await application!.close()
  application = undefined
  page = await launch(true)
  await page.locator('[data-testid^="e2e/shared/sidebar/tasks/"]').first().click()
  const restoredImage = page.locator('.conversation-stream .user-message img[alt="上传的图片"]')
  await expect(restoredImage).toBeVisible({ timeout: 10_000 })
  await expect(restoredImage).toHaveJSProperty('naturalWidth', 1600)
  await page.getByRole('button', { name: '放大图片' }).click()
  await expect(page.locator('.image-preview img[alt="上传的图片"]')).toBeVisible()
})
