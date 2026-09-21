import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function launch(): Promise<Page> {
  userDataDirectory = mkdtempSync(join(tmpdir(), 'actiondriver-local-e2e-'))
  application = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot
  })
  const page = await application.firstWindow()
  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  return page
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
