import { getElectronForkExecutable } from './support/electron-fork'
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeOpenAiToolServer } from './support/fake-openai-tool-server'

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url))
const runtimeEntry = fileURLToPath(new URL('../../../local-runtime/dist/index.js', import.meta.url))
const mainBundle = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))
const apiKey = 'sk-e2e-tool-secret'

let application: ElectronApplication | undefined
let provider: FakeOpenAiToolServer | undefined
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
  if (userDataDirectory) rmSync(userDataDirectory, { recursive: true, force: true })
  if (homeDirectory) rmSync(homeDirectory, { recursive: true, force: true })
})

async function launch(
  mode:
    | 'activity'
    | 'read'
    | 'shell'
    | 'shell-timeout'
    | 'python'
    | 'node'
    | 'text'
    | 'tool-preparing'
    | 'python-blocking'
    | 'deliverable'
    | 'image'
    | 'image-partial'
    | 'image-cancel'
    | 'image-replay'
    | 'vision'
    | 'vision-rejected',
  visionState: 'success' | 'unsupported' = 'success'
): Promise<Page> {
  provider = new FakeOpenAiToolServer(mode)
  await provider.start()
  userDataDirectory = mkdtempSync(join(tmpdir(), 'action-driver-tool-e2e-data-'))
  homeDirectory = mkdtempSync(join(tmpdir(), 'action-driver-tool-e2e-home-'))
  const workspace = join(userDataDirectory, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'README.md'), '# E2E workspace\n\nneedle is present.\n')
  if (mode === 'shell-timeout') execFileSync('mkfifo', [join(workspace, 'BLOCKING_FIFO')])
  application = await electron.launch({ executablePath: await getElectronForkExecutable(),
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: homeDirectory,
      ACTION_DRIVER_E2E_HOME_DIRECTORY: homeDirectory,
      ...(mode === 'shell-timeout' ? { ACTION_DRIVER_SCRIPT_TIMEOUT_MS: '10000' } : {}),
    }
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => console.error(`[renderer:pageerror] ${error.message}`))
  await expect(page.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
  await page.evaluate(
    async ({ baseUrl, secret, visionState }) => {
      const connection = await window.productDesktop.runtimeConnection.get()
      const url = new URL(connection.wsUrl)
      url.protocol = 'http:'
      url.pathname = '/model-connections'
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          draft: {
            name: 'E2E Tool Provider',
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
              capabilities: {
                text: { state: 'success', source: 'probe' },
                vision: { state: visionState, source: 'probe' },
                image_generation: { state: 'success', source: 'probe' }
              }
            },
            {
              id: 'e2e-image-model',
              name: 'e2e-image-model',
              enabled: true,
              testState: 'success',
              capabilities: { image_generation: { state: 'success', source: 'probe' } }
            }
          ]
        })
      })
      if (!response.ok || !((await response.json()) as { ok: boolean }).ok) {
        throw new Error('Runtime model connection setup failed')
      }
    },
    { baseUrl: provider.baseUrl, secret: apiKey, visionState }
  )
  await page.reload()
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText(
    'E2E Tool Provider / e2e-tool-model'
  )
  return page
}

test('shows only elapsed time and streamed text until a tool is actually called', async () => {
  const page = await launch('text')
  const taskId = await sendGoal(page, '直接回答')
  const process = page.getByRole('region', { name: '任务过程' })
  try {
    await expect(process).toContainText('正在思考')
    const elapsedBox = await process.locator('.activity-elapsed').boundingBox()
    const thinkingBox = await process.locator('.activity-thinking').boundingBox()
    expect(elapsedBox).not.toBeNull()
    expect(thinkingBox).not.toBeNull()
    // The indicator keeps a clear gap below the elapsed divider (see the
    // spacing contract in agent.css), so assert that gap instead of a hard 12px.
    expect(thinkingBox!.y - (elapsedBox!.y + elapsedBox!.height)).toBeGreaterThanOrEqual(14)
    expect(thinkingBox!.y - (elapsedBox!.y + elapsedBox!.height)).toBeLessThanOrEqual(24)
    await expect(process.locator('.activity-group')).toHaveCount(0)
    await expect.poll(() => provider!.completions.length).toBe(1)
    expect(provider!.completions[0]?.tools?.map((tool) => tool.function?.name)).not.toContain(
      'tools_local_image_generation_generate'
    )
    provider!.releaseTextStart()
    await expect(page.getByTestId('e2e/tasks/detail/markdown#section').last()).toContainText(
      '纯文本'
    )
    await expect(process).toContainText('已处理')
    await expect(process.locator('.activity-group')).toHaveCount(0)
    await expect(process).not.toContainText('正在处理请求')
  } finally {
    provider!.releaseTextStart()
    provider!.releaseText()
  }
  await expect(page.getByTestId('e2e/tasks/detail/markdown#section').last()).toContainText(
    '纯文本回答'
  )
  await page.reload()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
    'data-task-id',
    taskId
  )
  await expect(
    page.getByRole('region', { name: '任务过程' }).locator('.activity-group')
  ).toHaveCount(0)
})

test('keeps the running indicator clear of the divider in the initial state', async () => {
  const page = await launch('tool-preparing')
  await sendGoal(page, '运行一个阻塞脚本')
  const elapsed = page.locator('.activity-elapsed')
  const thinking = page.locator('.activity-thinking')
  await expect(thinking).toBeVisible({ timeout: 10_000 })
  const spacing = await page.evaluate(() => {
    const divider = document.querySelector('.activity-elapsed') as HTMLElement
    const indicator = document.querySelector('.activity-thinking') as HTMLElement
    return {
      fromDividerToText:
        indicator.getBoundingClientRect().top - divider.getBoundingClientRect().bottom
    }
  })
  // Spacing comes from the timeline gap, so it does not shift when the row is
  // replaced by the activity group.
  expect(spacing.fromDividerToText).toBeGreaterThanOrEqual(14)
  await expect(elapsed).toBeVisible()
  provider!.releaseTool()
  if (process.env.ACTION_DRIVER_VISUAL_CAPTURE) {
    await page.locator('.activity-timeline').screenshot({
      path: test.info().outputPath('activity-initial-thinking.png')
    })
  }
})

test('streams the tool name while arguments are incomplete without creating a tool row', async () => {
  const page = await launch('tool-preparing')
  await sendGoal(page, '运行命令')
  const process = page.getByRole('region', { name: '任务过程' })
  try {
    await expect(process.getByRole('status')).toContainText('正在思考')
    await expect(process.locator('.activity-group')).toHaveCount(0)
    await expect(process).not.toContainText('rg needle')
    await page.reload()
    await expect(process.getByRole('status')).toContainText('正在思考')
  } finally {
    provider!.releaseTool()
  }
  await expect(page.getByTestId('e2e/tasks/detail/markdown#section').last()).toContainText('已读取')
  await expect(process.getByRole('status')).toHaveCount(0)
})

async function runtimeTask(
  page: Page,
  taskId: string
): Promise<{
  sessionId: string
  status: string
  messages: Array<{ content: unknown }>
} | null> {
  return await page.evaluate(async (id) => {
    const connection = await window.productDesktop.runtimeConnection.get()
    const url = new URL(connection.wsUrl)
    url.protocol = 'http:'
    url.pathname = `/tasks/${encodeURIComponent(id)}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${connection.accessToken}` }
    })
    const body = (await response.json()) as {
      ok: boolean
      value: {
        task: { sessionId: string; status: string; messages: Array<{ content: unknown }> } | null
      }
    }
    if (!response.ok || !body.ok) throw new Error('Runtime task query failed')
    return body.value.task
  }, taskId)
}

async function selectDefaultImageModel(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const connection = await window.productDesktop.runtimeConnection.get()
    const url = new URL(connection.wsUrl)
    url.protocol = 'http:'
    const headers = {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/json'
    }
    url.pathname = '/model-connections'
    const listResponse = await fetch(url, { headers })
    const list = (await listResponse.json()) as {
      ok: boolean
      value: Array<{ id: string }>
    }
    if (!listResponse.ok || !list.ok || !list.value[0]) throw new Error('Missing model connection')
    url.pathname = '/model-connections/default-image-model'
    const defaultResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: { connectionId: list.value[0].id, modelId: 'e2e-image-model' }
      })
    })
    if (!defaultResponse.ok) throw new Error('Cannot select default image model')
  })
  await page.reload()
}

test('uploads an image for model recognition and restores it from session assets', async () => {
  const page = await launch('vision')
  await page.getByLabel('添加图片').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: readFileSync(join(desktopRoot, '../local-runtime/tests/fixtures/tiny.png'))
  })
  await page.getByLabel('任务描述').fill('识别图片')
  await page.getByLabel('发送').click()
  const taskPage = page.getByTestId('e2e/tasks/detail/page#page')
  const taskId = await taskPage.getAttribute('data-task-id')
  expect(taskId).toMatch(/^task-/)
  await expect(page.getByText('识别到了图片')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('img', { name: '上传的图片' })).toBeVisible()
  const thumbnail = await page.getByRole('button', { name: '放大图片' }).boundingBox()
  expect(thumbnail?.width).toBe(104)
  expect(thumbnail?.height).toBe(104)
  expect(JSON.stringify(provider!.completions[0]?.messages)).toContain('data:image/png;base64,')
  expect(JSON.stringify(await runtimeTask(page, taskId!))).not.toContain('data:image/png;base64,')
  const task = await runtimeTask(page, taskId!)
  expect(task).not.toBeNull()
  const uploads = join(
    userDataDirectory,
    'data',
    'sessions',
    task!.sessionId,
    'attachments',
    'uploads'
  )
  expect(readdirSync(uploads)).toHaveLength(1)
  expect(readFileSync(join(uploads, readdirSync(uploads)[0]!))).toEqual(
    readFileSync(join(desktopRoot, '../local-runtime/tests/fixtures/tiny.png'))
  )
  await page.reload()
  await expect(page.getByRole('img', { name: '上传的图片' })).toBeVisible()
  await expect(page.getByText('识别到了图片')).toBeVisible()
})

test('keeps an image draft and skips provider calls when vision is unverified', async () => {
  const page = await launch('vision', 'unsupported')
  await page.getByLabel('添加图片').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: readFileSync(join(desktopRoot, '../local-runtime/tests/fixtures/tiny.png'))
  })
  await page.getByLabel('任务描述').fill('识别图片')
  await page.getByLabel('发送').click()
  await expect(page.getByRole('alert')).toContainText('视觉测试尚未通过')
  await expect(page.getByText('tiny.png')).toBeVisible()
  await expect(page.getByLabel('任务描述')).toContainText('识别图片')
  expect(provider!.completions).toHaveLength(0)
  await page.getByRole('button', { name: '打开模型设置' }).click()
  await expect(page.getByRole('heading', { name: '模型连接' })).toBeVisible()
})

test('offers a verified text and image model in both chat and default image settings', async () => {
  const page = await launch('vision')
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText('e2e-tool-model')
  await page.getByRole('button', { name: '设置' }).click()
  const choice = page.getByRole('button', { name: '设为默认生图模型：e2e-tool-model' })
  await expect(choice).toBeVisible()
  await choice.click()
  await expect(page.getByRole('button', { name: '取消默认生图模型：e2e-tool-model' })).toBeVisible()
  await page.getByRole('button', { name: '返回应用' }).click()
  await expect(page.getByRole('button', { name: /当前模型/ })).toContainText('e2e-tool-model')
})

test('shows the provider image rejection in the failed turn after reload', async () => {
  const page = await launch('vision-rejected')
  await page.getByLabel('添加图片').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: readFileSync(join(desktopRoot, '../local-runtime/tests/fixtures/tiny.png'))
  })
  await page.getByLabel('任务描述').fill('这是什么')
  await page.getByLabel('发送').click()
  await expect(page.getByRole('alert')).toContainText('Unexpected item type in content.', {
    timeout: 15_000
  })
  await expect(page.getByRole('img', { name: '上传的图片' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Unexpected item type in content.')
})

test('shows four independently completed images and restores them after reload', async () => {
  const page = await launch('image')
  await selectDefaultImageModel(page)
  const taskId = await sendGoal(page, '生成四张图')
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByText('图片已生成')).toBeVisible()
  expect(provider!.imageGenerations).toHaveLength(4)
  expect(provider!.imageGenerations.every((request) => request.n === 1)).toBe(true)
  expect(provider!.imageCompletions).toHaveLength(4)
  expect(provider!.imageCompletions[0]).not.toBe('one')
  expect(JSON.stringify(await runtimeTask(page, taskId))).not.toContain('iVBORw0KGgo')
  const task = await runtimeTask(page, taskId)
  expect(task).not.toBeNull()
  expect(
    readdirSync(
      join(userDataDirectory, 'data', 'sessions', task!.sessionId, 'attachments', 'generated')
    )
  ).toHaveLength(4)
  await page.reload()
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(4)
  await expect(page.getByText('图片已生成')).toBeVisible()
})

test('retains successful generated images when one request fails', async () => {
  const page = await launch('image-partial')
  await selectDefaultImageModel(page)
  await sendGoal(page, '生成四张图，其中一张失败')
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(3, { timeout: 20_000 })
  await expect(page.getByText('图片已生成')).toBeVisible()
  expect(provider!.imageGenerations).toHaveLength(4)
  expect(provider!.imageCompletions).toHaveLength(3)
})

test('replays an in-progress image batch after reload without repeating generation', async () => {
  const page = await launch('image-replay')
  await selectDefaultImageModel(page)
  const taskId = await sendGoal(page, '生成四张图并恢复进度')
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(1, { timeout: 20_000 })
  await page.reload()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
    'data-task-id',
    taskId
  )
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(4, { timeout: 20_000 })
  expect(provider!.imageGenerations).toHaveLength(4)
  await expect(page.getByText('图片已生成')).toBeVisible()
})

test('stops pending image requests without late successful images', async () => {
  const page = await launch('image-cancel')
  await selectDefaultImageModel(page)
  await sendGoal(page, '生成图片后取消')
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(1, { timeout: 20_000 })
  await page.getByLabel('中断任务').click()
  await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
    'data-state',
    'idle'
  )
  await expect(page.getByRole('img', { name: '生成的图片' })).toHaveCount(1)
  expect(provider!.imageCompletions).toEqual(['one'])
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

test('preserves the first turn duration and archive after a follow-up and reload', async () => {
  const page = await launch('read')
  await sendGoal(page, '测试所有工具')
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
    'data-state',
    'idle'
  )
  await sendGoal(page, '111')
  await expect(page.getByRole('heading', { name: '已读取' })).toHaveCount(2, { timeout: 15_000 })
  const stream = page.locator('.conversation-stream')
  const archives = page.getByTestId('e2e/tasks/detail/activity/archive#button')
  await expect(archives).toHaveCount(1)
  await expect(stream).toContainText(/测试所有工具.*用时.*已读取.*111.*用时.*已读取/s)
  await archives.click()
  await expect(page.locator('.activity-group')).toHaveCount(1)
  await page.reload()
  await expect(page.getByTestId('e2e/tasks/detail/activity/archive#button')).toHaveCount(1)
  await expect(stream).toContainText(/测试所有工具.*用时.*已读取.*111.*用时.*已读取/s)
})

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
  expect(first?.tools?.map((tool) => tool.function?.name)).toContain('tools_local_command_shell_run')
  expect(first?.tool_choice).toBe('auto')
  expect(second?.messages).toContainEqual(
    expect.objectContaining({
      role: 'tool',
      tool_call_id: 'provider-tool-1',
      name: 'tools_local_command_shell_run'
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

  await page.reload()
  await expect
    .poll(async () => runtimeTask(page, taskId).then((task) => task?.messages.at(-1)?.content))
    .toContain('已读取')
})

test('keeps interleaved process and tool calls ordered live and after reopening', async () => {
  const page = await launch('activity')
  const taskId = await sendGoal(page, '调研 README')
  const archive = page.getByTestId('e2e/tasks/detail/activity/archive#button')
  await expect(archive).toBeVisible({ timeout: 15_000 })
  await expect(archive).toContainText('用时')
  const archiveArrow = archive.locator('.activity-chevron')
  await expect(archiveArrow).toHaveClass(/lucide-chevron-right/)
  await page.mouse.move(0, 0)
  await expect(archiveArrow).toHaveCSS('opacity', '1')
  const archiveArrowBeforeHover = await archiveArrow.boundingBox()
  await archive.hover()
  await expect(archiveArrow).toHaveCSS('opacity', '1')
  expect(await archiveArrow.boundingBox()).toEqual(archiveArrowBeforeHover)
  await page.mouse.move(0, 0)
  await page.keyboard.press('Tab')
  await archive.focus()
  await expect(archiveArrow).toHaveCSS('opacity', '1')
  const archiveDetails = archive.locator('..')
  await expect(archiveDetails).not.toHaveAttribute('open', '')
  await expect(page.locator('.activity-process-text')).toHaveCount(2)
  await expect(page.locator('.activity-process-text').first()).toBeHidden()
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible()
  await archive.click()
  const groups = page.locator('.activity-group')
  await expect(groups).toHaveCount(2)
  // The process prose the model wrote before its tools sits above them in the
  // activity area, and the answer stays in the transcript.
  const processFlow = await page
    .getByRole('region', { name: '任务过程' })
    .locator('.activity-process-text, .activity-group')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.classList.contains('activity-group') ? 'activity' : 'text'))
    )
  expect(processFlow).toEqual(['text', 'activity', 'text', 'activity'])
  await expect(page.locator('.conversation-stream .agent-message')).not.toContainText('正文 A')
  await expect(page.locator('.conversation-stream .agent-message')).toContainText('已读取')
  const group = groups.first()
  await group.locator('summary').first().click()
  const groupHeading = group.locator(':scope > summary')
  const groupArrow = groupHeading.locator('.activity-chevron')
  await expect(groupArrow).toHaveClass(/lucide-chevron-right/)
  await page.mouse.move(0, 0)
  await expect(groupArrow).toHaveCSS('opacity', '0')
  const groupArrowBeforeHover = await groupArrow.boundingBox()
  await groupHeading.hover()
  await expect(groupArrow).toHaveCSS('opacity', '1')
  expect(await groupArrow.boundingBox()).toEqual(groupArrowBeforeHover)
  await page.mouse.move(0, 0)
  await page.keyboard.press('Tab')
  await groupHeading.focus()
  await expect(groupArrow).toHaveCSS('opacity', '1')
  const items = group.locator('.activity-items > *')
  await expect(items).toHaveCount(1)
  const live = await items.allTextContents()
  expect(live[0]).toContain('已执行命令')
  await expect(groups.nth(1).locator('.activity-items > *')).toHaveCount(1)
  await expect(group).not.toContainText('正文 A')
  await expect(group).not.toContainText('正文 B')
  expect(
    (await page.locator('.activity-process-text').allTextContents()).map((text) => text.trim())
  ).toEqual(['正文 A', '正文 B'])
  await expect(page.getByTestId('e2e/tasks/detail/activity/raw-io#button')).toHaveCount(2)
  const toolHeading = page.getByTestId('e2e/tasks/detail/activity/raw-io#button').first()
  const toolArrow = toolHeading.locator('.activity-chevron')
  await expect(toolArrow).toHaveClass(/lucide-chevron-right/)
  await page.mouse.move(0, 0)
  await expect(toolArrow).toHaveCSS('opacity', '0')
  const toolArrowBeforeHover = await toolArrow.boundingBox()
  await toolHeading.hover()
  await expect(toolArrow).toHaveCSS('opacity', '1')
  expect(await toolArrow.boundingBox()).toEqual(toolArrowBeforeHover)
  await page.mouse.move(0, 0)
  await page.keyboard.press('Tab')
  await toolHeading.focus()
  await expect(toolArrow).toHaveCSS('opacity', '1')
  await page.getByTestId('e2e/tasks/detail/activity/raw-io#button').first().click()
  await expect(group).toContainText('README.md')
  const groupIcon = await group.locator(':scope > summary svg').first().boundingBox()
  const groupTitle = await group.locator(':scope > summary span').boundingBox()
  const groupChevron = await group.locator(':scope > summary svg').last().boundingBox()
  const childIcon = await group.locator('.activity-tool-line svg').first().boundingBox()
  const childLabel = await group.locator('.activity-tool-label').first().boundingBox()
  const ioPanel = await group.locator('.activity-tool-io').first().boundingBox()
  expect(groupIcon).not.toBeNull()
  expect(groupTitle).not.toBeNull()
  expect(groupChevron).not.toBeNull()
  expect(childIcon).not.toBeNull()
  expect(childLabel).not.toBeNull()
  expect(ioPanel).not.toBeNull()
  expect(Math.abs(childIcon!.x - groupIcon!.x)).toBeLessThanOrEqual(2)
  expect(
    Math.abs(groupIcon!.y + groupIcon!.height / 2 - (groupTitle!.y + groupTitle!.height / 2))
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(childIcon!.y + childIcon!.height / 2 - (childLabel!.y + childLabel!.height / 2))
  ).toBeLessThanOrEqual(1)
  expect(childIcon!.width).toBe(16)
  await expect(group.locator('.activity-tool-line').first()).toHaveCSS('font-size', '14px')
  await expect(group.locator('.activity-tool-line').first()).toHaveCSS('line-height', '22px')
  expect(Math.abs(ioPanel!.x - groupIcon!.x)).toBeLessThanOrEqual(2)
  expect(groupChevron!.x - (groupTitle!.x + groupTitle!.width)).toBeLessThanOrEqual(12)
  expect(groupChevron!.x - groupTitle!.x).toBeLessThan(180)
  await expect(group.locator(':scope > summary svg').last()).toHaveCSS('transform', 'none')
  if (process.env.ACTION_DRIVER_VISUAL_CAPTURE) {
    await page.screenshot({ path: test.info().outputPath('activity-expanded.png') })
  }
  expect(provider!.completions).toHaveLength(3)
  expect(provider!.completions[0]?.tools?.map((tool) => tool.function?.name)).not.toContain(
    'activity_update'
  )

  await page.reload()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
    'data-task-id',
    taskId
  )
  await expect(page.locator('.task-header strong')).toHaveText('调研 README')
  await expect(page.getByTestId(`e2e/shared/sidebar/tasks/${taskId}#button`)).toHaveAttribute(
    'aria-current',
    'page'
  )
  await expect(page.getByTestId('e2e/tasks/detail/activity/archive#button')).toBeVisible()
  await page.getByTestId('e2e/tasks/detail/activity/archive#button').click()
  const restoredGroups = page.locator('.activity-group')
  await expect(restoredGroups).toHaveCount(2)
  const restoredGroup = restoredGroups.first()
  await restoredGroup.locator('summary').first().click()
  const restoredItems = restoredGroup.locator('.activity-items > *')
  await expect(restoredItems).toHaveCount(1)
  expect(await restoredItems.allTextContents()).toEqual(live)
  await expect(restoredGroup).not.toContainText('正文 A')
  await expect(restoredGroup).not.toContainText('正文 B')
  await expect(page.getByTestId('e2e/tasks/detail/activity/raw-io#button')).toHaveCount(2)
  await page.getByTestId('e2e/tasks/detail/activity/raw-io#button').first().click()
  await expect(restoredGroup).toContainText('README.md')
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible()

  const shortItems = restoredGroups.nth(1).locator('.activity-items')
  await restoredGroups.nth(1).locator(':scope > summary').click()
  const shortSize = await shortItems.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }))
  expect(shortSize.scrollHeight).toBeLessThanOrEqual(shortSize.clientHeight)
  await expect(shortItems).toHaveCSS('mask-image', 'none')

  const longItems = restoredGroup.locator('.activity-items')
  await longItems.evaluate((element) => {
    const row = element.firstElementChild
    if (!row) throw new Error('Expected an activity row')
    for (let index = 0; index < 40; index++) element.append(row.cloneNode(true))
  })
  const longSize = await longItems.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    viewportHeight: window.innerHeight,
    headingBottom: element.parentElement!.querySelector(':scope > summary')!.getBoundingClientRect()
      .bottom,
    itemsTop: element.getBoundingClientRect().top
  }))
  expect(longSize.clientHeight).toBeLessThanOrEqual(Math.min(420, longSize.viewportHeight / 2))
  expect(longSize.scrollHeight).toBeGreaterThan(longSize.clientHeight)
  expect(longSize.itemsTop).toBeGreaterThanOrEqual(longSize.headingBottom)
  await expect(longItems).toHaveCSS('mask-image', /linear-gradient/)
  if (process.env.ACTION_DRIVER_VISUAL_CAPTURE) {
    await page.screenshot({ path: test.info().outputPath('activity-scroll-fade.png') })
  }
  const headingBeforeScroll = await restoredGroup.locator(':scope > summary').boundingBox()
  await longItems.evaluate((element) => {
    element.scrollTop = 300
  })
  expect(await longItems.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await restoredGroup.locator(':scope > summary').boundingBox()).toEqual(headingBeforeScroll)
  await longItems.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  // Every scroll container fades the edges that still hide content, including
  // the top edge once the list is scrolled to its end.
  await expect(longItems).toHaveAttribute('data-fade', /top/)
  await expect(longItems).not.toHaveAttribute('data-fade', /bottom/)
  await expect(longItems).toHaveCSS('mask-image', /linear-gradient/)
})

test('registers a generated deliverable as a task output card after reload', async () => {
  const page = await launch('deliverable')
  await sendGoal(page, '生成一份 PDF 交付')
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
    'data-state',
    'idle',
    { timeout: 15_000 }
  )
  const cards = page.getByTestId('e2e/tasks/detail/output-file#section')
  await expect(cards).toHaveCount(2)
  await expect(cards.filter({ hasText: 'report.pdf' })).toHaveCount(1)
  await expect(cards.filter({ hasText: 'summary.pdf' })).toHaveCount(1)
  await expect(cards.filter({ hasText: 'report.pdf' }).locator('img')).toHaveAttribute('alt', 'PDF')
  await expect(page.getByRole('button', { name: '打开文件' })).toHaveCount(2)

  await page.reload()
  await expect(page.getByTestId('e2e/tasks/detail/output-file#section')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '打开文件' })).toHaveCount(2)
  // Hover only tints the surface: no shadow or border change.
  const resting = await cards.first().evaluate((element) => {
    const style = getComputedStyle(element)
    return JSON.stringify({
      background: style.backgroundColor,
      boxShadow: style.boxShadow,
      borderColor: style.borderTopColor
    })
  })
  await cards.first().hover()
  await expect
    .poll(async () =>
      cards.first().evaluate((element) => getComputedStyle(element).backgroundColor)
    )
    .not.toBe(JSON.parse(resting).background)
  const hovered = await cards.first().evaluate((element) => {
    const style = getComputedStyle(element)
    return JSON.stringify({
      boxShadow: style.boxShadow,
      borderColor: style.borderTopColor
    })
  })
  expect(hovered).toBe(
    JSON.stringify({ boxShadow: JSON.parse(resting).boxShadow, borderColor: JSON.parse(resting).borderColor })
  )
  if (process.env.ACTION_DRIVER_VISUAL_CAPTURE) {
    await page.locator('.task-output-files').screenshot({
      path: test.info().outputPath('task-output-files.png')
    })
  }

  // A follow-up turn that produces nothing must not drop the earlier turn's card.
  provider!.setMode('vision')
  await sendGoal(page, '再补充一句说明')
  await expect(page.getByText('识别到了图片').last()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
    'data-state',
    'idle',
    { timeout: 15_000 }
  )
  await expect(page.getByTestId('e2e/tasks/detail/output-file#section')).toHaveCount(2)
  await expect
    .poll(async () =>
      (await page.getByTestId('e2e/tasks/detail/output-file#section').allTextContents()).join(' ')
    )
    .toContain('report.pdf')

  // The earlier turn's cards also survive a reload of the follow-up task.
  await page.reload()
  await expect(page.getByTestId('e2e/tasks/detail/output-file#section')).toHaveCount(2)
  await expect
    .poll(async () =>
      (await page.getByTestId('e2e/tasks/detail/output-file#section').allTextContents()).join(' ')
    )
    .toContain('report.pdf')

  // A second session registers its own cards, and switching back keeps the first session's.
  await page.getByRole('button', { name: '新任务' }).click()
  provider!.setMode('deliverable')
  await sendGoal(page, '再生成两份 PDF 交付')
  await expect(page.getByTestId('e2e/shared/composer/root#section')).toHaveAttribute(
    'data-state',
    'idle',
    { timeout: 15_000 }
  )
  await expect(page.getByTestId('e2e/tasks/detail/output-file#section')).toHaveCount(2)
  await expect(page.getByText('再生成两份 PDF 交付').first()).toBeVisible()

  await page.getByRole('button', { name: '生成一份 PDF 交付', exact: true }).first().click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-task-id', /.+/)
  await expect(page.getByTestId('e2e/tasks/detail/output-file#section')).toHaveCount(2)
  await expect
    .poll(async () =>
      (await page.getByTestId('e2e/tasks/detail/output-file#section').allTextContents()).join(' ')
    )
    .toContain('report.pdf')
})

test('runs a granted shell command without approval and answers', async () => {
  const page = await launch('shell')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sendGoal(page, '在 README 中查找 needle')
  await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
  if (process.env.ACTION_DRIVER_VISUAL_CAPTURE) {
    await page.getByTestId('e2e/tasks/detail/activity/archive#button').click()
    await page.locator('.activity-group > summary').click()
    await page.locator('.activity-tool > summary').first().click()
    await page.screenshot({ path: test.info().outputPath('shell-expanded.png') })
  }
  await expect.poll(() => provider!.completions.length).toBe(2)
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('needle is present')
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
})

for (const mode of ['python', 'node'] as const) {
  test(`runs bundled ${mode} through the model tool lifecycle`, async () => {
    const page = await launch(mode)
    await sendGoal(page, `运行 ${mode}`)
    await expect(page.getByRole('heading', { name: '已读取' })).toBeVisible({ timeout: 15_000 })
    expect(provider!.completions[0]?.tools?.map((tool) => tool.function?.name)).toContain(
      `${mode}_run`
    )
    expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('/dist/runtimes/darwin-')
    await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
  })
}

test('times out a granted shell process and reports the terminal error', async () => {
  test.skip(process.platform === 'win32', 'This POSIX test uses a named pipe')
  test.setTimeout(30_000)
  const page = await launch('shell-timeout')
  await sendGoal(page, '在阻塞文件中查找 needle')
  const group = page.locator('details.activity-group')
  await expect(group.locator(':scope > summary span')).toHaveClass(/activity-active-title/)
  await expect(group).not.toHaveAttribute('open', '')
  await group.locator(':scope > summary').click()
  await expect(group).toHaveAttribute('open', '')
  const runningTool = page.locator('.activity-tool.is-running')
  await expect(runningTool).toBeVisible({ timeout: 15_000 })
  await expect(runningTool.locator('.activity-tool-label')).toHaveClass(/activity-active-title/)
  await expect(runningTool.locator('.activity-tool-label')).toHaveCSS(
    'animation-name',
    'activity-title-sheen'
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(runningTool.locator('.activity-tool-label')).toHaveCSS('animation-name', 'none')
  await expect(group).toHaveAttribute('open', '')
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '已超时' })).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('e2e/tasks/detail/activity/archive#button').click()
  await expect(page.locator('.activity-group > summary')).toContainText('执行失败')
  await expect(page.locator('.activity-group > summary span')).not.toHaveClass(
    /activity-active-title/
  )
  expect(JSON.stringify(provider!.completions[1]?.messages)).toContain('TOOL_TIMEOUT')
  expect(JSON.stringify(provider!.completions[1]?.messages)).not.toContain('needle is present')
})

test('cancels a running granted shell command without an approval step', async () => {
  test.skip(process.platform === 'win32', 'This POSIX test uses a named pipe')
  const page = await launch('shell-timeout')
  const taskId = await sendGoal(page, '在阻塞文件中查找 needle')
  await expect(page.locator('.activity-tool.is-running')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('details.activity-group')).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('e2e/tasks/detail/activity/approve#button')).toHaveCount(0)
  await page.getByLabel('中断任务').click()
  await expect
    .poll(async () => runtimeTask(page, taskId).then((task) => task?.status))
    .toBe('paused')
  expect(provider!.completions).toHaveLength(1)
})
