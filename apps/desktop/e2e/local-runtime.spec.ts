import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

/**
 * Desktop integration coverage for the local Agent Runtime.
 *
 * The app runs in its production (local) composition: Electron Main forks the Agent Runtime
 * utility process, the Runtime owns SQLite and the LangGraph checkpoint, and the Skill Provider
 * Host only exposes Mock Browser/Computer providers. Run it with `pnpm test:e2e:local`, which
 * prepares the Electron native SQLite binding, the Runtime bundle and the local app build.
 */
const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const runtimeEntry = fileURLToPath(new URL('../../agent-runtime/dist/index.js', import.meta.url))
const mainBundle = fileURLToPath(new URL('../out/main/index.js', import.meta.url))

/** Deterministic Mock goal markers defined by `DeterministicModelGateway`. */
const PENDING_PLAN_GOAL = '整理本周行程（长时间准备）'
const USER_INPUT_GOAL = '预订杭州酒店（等待确认）'

let application: ElectronApplication | undefined
let userDataDirectory: string | undefined
let homeDirectory: string | undefined

test.beforeAll(() => {
  expect(
    existsSync(runtimeEntry),
    'The Agent Runtime bundle is missing; run "pnpm test:e2e:local" instead of raw playwright.'
  ).toBe(true)
  expect(
    readFileSync(mainBundle, 'utf8').includes('ACTIONDRIVER_RUNTIME_DATABASE_PATH'),
    'The desktop build is not the local composition; run "pnpm test:e2e:local" so the production build is present.'
  ).toBe(true)
})

test.afterEach(async () => {
  await application?.close()
  application = undefined
})

async function launch({ reuseDirectories = false } = {}): Promise<Page> {
  if (!reuseDirectories || !userDataDirectory || !homeDirectory) {
    userDataDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-local-e2e-data-'))
    homeDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-local-e2e-home-'))
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

function setSkillEnabled(page: Page, skillId: string, enabled: boolean): Promise<void> {
  return page.evaluate(
    async ([id, nextEnabled]) => {
      await window.actionDriverDesktop.agentFiles.setSkillEnabled(
        id as string,
        nextEnabled as boolean
      )
    },
    [skillId, enabled] as const
  )
}

function taskIdOf(page: Page): Promise<string | null> {
  return page.getByTestId('e2e/tasks/detail/page#page').getAttribute('data-task-id')
}

function agentStatus(page: Page, taskId: string): Promise<string | null> {
  return page.evaluate(
    async (id) => (await window.actionDriverDesktop.agent.get(id))?.status ?? null,
    taskId
  )
}

function continueTask(page: Page, taskId: string): Promise<void> {
  return page.evaluate((id) => window.actionDriverDesktop.agent.continue(id), taskId)
}

function provideInput(page: Page, taskId: string, value: unknown): Promise<void> {
  return page.evaluate(
    ([id, input]) => window.actionDriverDesktop.agent.provideInput(id as string, input),
    [taskId, value] as const
  )
}

async function submitGoal(page: Page, goal: string) {
  await page.getByLabel('任务描述').fill(goal)
  await page.getByLabel('发送').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
  const taskId = await taskIdOf(page)
  expect(taskId).toMatch(/^task-/)
  return taskId as string
}

function runtimeProcessCount(): number {
  if (!userDataDirectory) return 0
  const instanceMarker = basename(userDataDirectory)
  try {
    const output = execFileSync('ps', ['-ax', '-o', 'command'], { encoding: 'utf8' })
    return output
      .split('\n')
      .filter(
        (line) =>
          line.includes('--utility-sub-type=node.mojom.NodeService') &&
          line.includes(instanceMarker)
      ).length
  } catch {
    return 0
  }
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

test('carries a local Runtime task through submit, interrupt, continue and shutdown', async () => {
  const page = await launch()

  // 提交目标：真实 UI → Preload → Main IPC → Runtime 命令
  const taskId = await submitGoal(page, PENDING_PLAN_GOAL)

  // 时间线：Runtime 投影出任务消息与执行步骤
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toContainText(PENDING_PLAN_GOAL)
  await expect(page.getByRole('heading', { name: '执行进度' })).toBeVisible()
  await expect(page.getByText('执行任务')).toBeVisible()
  await expect(page.getByText('Browser Skill · 运行中')).toBeVisible()
  expect(await agentStatus(page, taskId)).toBe('running')

  // 中断运行中的任务：Mock 模型等待中断信号，Runtime 停在最近安全 checkpoint
  await page.getByTestId('e2e/shared/composer/interrupt#button').click()
  await expect(page.getByText('Browser Skill · 已暂停')).toBeVisible()
  await expect.poll(() => agentStatus(page, taskId)).toBe('paused')

  // 继续：从 checkpoint 恢复，事件驱动时间线继续更新到完成
  await continueTask(page, taskId)
  await expect(page.getByText('Browser Skill · 已完成')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => agentStatus(page, taskId)).toBe('succeeded')
  await expect(page.getByText('任务已完成')).toBeVisible()

  // 退出清理：Main 停止 Supervisor，Runtime utility process 与数据库写入一起结束
  expect(runtimeProcessCount()).toBeGreaterThan(0)
  await application!.close()
  application = undefined
  await expect.poll(runtimeProcessCount, { timeout: 15_000 }).toBe(0)
  expect(existsSync(join(userDataDirectory!, 'data', 'actiondriver.db'))).toBe(true)
})

test('waits for user input and resumes a local Runtime task from its checkpoint', async () => {
  const page = await launch()

  const taskId = await submitGoal(page, USER_INPUT_GOAL)

  await expect(page.getByText('Browser Skill · 等待用户')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => agentStatus(page, taskId)).toBe('waiting-user')

  await provideInput(page, taskId, { approved: true })

  await expect(page.getByText('Browser Skill · 已完成')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => agentStatus(page, taskId)).toBe('succeeded')
  await expect(page.getByText('任务已完成')).toBeVisible()
})

test('enforces current Skill state across task snapshots and application restart', async () => {
  let page = await launch()
  const initialSkills = await page.evaluate(() =>
    window.actionDriverDesktop.agentFiles.listSkills()
  )
  expect(initialSkills.find((skill) => skill.id === 'browser-tools')).toMatchObject({
    enabled: true,
    available: true,
    executorId: 'browser-use'
  })
  expect(initialSkills.find((skill) => skill.id === 'computer-tools')).toMatchObject({
    enabled: true,
    available: true,
    executorId: 'computer-use'
  })
  const taskId = await submitGoal(page, PENDING_PLAN_GOAL)
  await expect.poll(() => agentStatus(page, taskId)).toBe('running')

  await setSkillEnabled(page, 'browser-tools', false)
  await setSkillEnabled(page, 'computer-tools', false)
  const browserSkillPath = join(
    homeDirectory!,
    '.action-driver',
    'skills',
    'browser-tools',
    'SKILL.md'
  )
  expect(readFileSync(browserSkillPath, 'utf8')).toContain('executor: browser-use')
  await page.getByTestId('e2e/shared/composer/interrupt#button').click()
  await expect.poll(() => agentStatus(page, taskId)).toBe('paused')
  await continueTask(page, taskId)
  await expect.poll(() => agentStatus(page, taskId), { timeout: 20_000 }).toBe('failed')

  await application!.close()
  application = undefined
  expect(readFileSync(browserSkillPath, 'utf8')).toContain('executor: browser-use')
  page = await launch({ reuseDirectories: true })
  const persistedSkills = await page.evaluate(() =>
    window.actionDriverDesktop.agentFiles.listSkills()
  )
  expect(persistedSkills.find((skill) => skill.id === 'browser-tools')).toMatchObject({
    enabled: false,
    available: true,
    executorId: 'browser-use'
  })

  await setSkillEnabled(page, 'browser-tools', true)
  const resumedTaskId = await submitGoal(page, USER_INPUT_GOAL)
  await expect
    .poll(() => agentStatus(page, resumedTaskId), { timeout: 20_000 })
    .toBe('waiting-user')
})

test('records real IPC and HTTP bodies without logging the log viewer itself', async () => {
  const page = await launch()
  const apiKey = 'sk-e2e-interaction-secret'

  await page.evaluate(async (secret) => {
    await window.actionDriverDesktop.modelConnections.list()
    await window.actionDriverDesktop.modelConnections.testConnection({
      name: 'E2E 日志连接',
      protocol: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: secret
    })
  }, apiKey)
  await submitGoal(page, PENDING_PLAN_GOAL)

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByTestId('e2e/settings/sidebar/logs#button').click()
  await expect(page.getByTestId('e2e/settings/logs/entries/0#button')).toBeVisible()

  await page.getByTestId('e2e/settings/logs/transport#button').click()
  await page.getByRole('menuitemcheckbox', { name: 'IPC' }).click()
  await expect(page.getByTestId('e2e/settings/logs/transport#button')).toContainText('IPC')
  await page.getByTestId('e2e/settings/logs/transport#button').click()
  await page.getByTestId('e2e/settings/logs/entries/0#button').click()
  await page.getByTestId('e2e/settings/logs/inspector/request#button').click()
  await page.getByTestId('e2e/settings/logs/inspector/response#button').click()

  await page.getByTestId('e2e/settings/logs/auto-refresh#switch').click()
  await expect(page.getByTestId('e2e/settings/logs/auto-refresh#switch')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await page.getByTestId('e2e/settings/logs/auto-refresh#switch').click()
  await page.getByTestId('e2e/settings/logs/inspector/close#button').click()
  await expect(page.getByTestId('e2e/settings/logs/transport#button')).toContainText('IPC')

  await page.getByTestId('e2e/settings/logs/transport#button').click()
  await page.getByRole('menuitemcheckbox', { name: 'IPC' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'HTTP' }).click()
  await expect(page.getByTestId('e2e/settings/logs/transport#button')).toContainText('HTTP')
  await expect(page.getByText('POST /model-connections/test')).toBeVisible()

  await application!.close()
  application = undefined
  const persisted = readInteractionFiles(join(userDataDirectory!, 'logs', 'interactions'))
  expect(persisted).not.toContain(apiKey)
  expect(persisted).not.toContain('actiondriver:logs:list')
  expect(persisted).not.toContain('actiondriver:logs:detail')
})
