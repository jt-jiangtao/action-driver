import { getElectronForkExecutable } from './support/electron-fork'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const sourceProfile = process.env.ACTIONDRIVER_REAL_SMOKE_PROFILE
const desktopRoot = fileURLToPath(new URL('../..', import.meta.url))

test.skip(!sourceProfile, 'Set ACTIONDRIVER_REAL_SMOKE_PROFILE to run against a saved connection')

async function runtimeTask(
  page: Page,
  taskId: string
): Promise<{
  status: string
  messages: Array<{ content: unknown }>
} | null> {
  return await page.evaluate(async (id) => {
    const connection = await window.actionDriverDesktop.runtimeConnection.get()
    const url = new URL(connection.wsUrl)
    url.protocol = 'http:'
    url.pathname = `/tasks/${encodeURIComponent(id)}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${connection.accessToken}` }
    })
    const body = (await response.json()) as {
      ok: boolean
      value: { task: { status: string; messages: Array<{ content: unknown }> } | null }
    }
    if (!response.ok || !body.ok) throw new Error('Runtime task query failed')
    return body.value.task
  }, taskId)
}

test('calls a saved real model and observes a real shell file read', async () => {
  test.setTimeout(90_000)
  const temporaryProfile = mkdtempSync(join(tmpdir(), 'actiondriver-real-tool-smoke-'))
  const userDataPath = join(temporaryProfile, 'user-data')
  const dataPath = join(userDataPath, 'data')
  const workspacePath = join(userDataPath, 'workspace')
  mkdirSync(dataPath, { recursive: true })
  mkdirSync(workspacePath, { recursive: true })
  const sourceData = join(sourceProfile!, 'data')
  execFileSync('sqlite3', [
    join(sourceData, 'actiondriver.db'),
    `.backup "${join(dataPath, 'actiondriver.db')}"`
  ])
  copyFileSync(join(sourceData, 'credential-secret'), join(dataPath, 'credential-secret'))
  // Session workspaces isolate scripts from the shared workspace root, so the
  // marker is written by the tool call itself inside the current session.
  writeFileSync(
    join(workspacePath, 'SMOKE_INSTRUCTIONS.md'),
    'Use tools_local_command_shell_run to create this marker inside the session working directory first:\n' +
      'ACTIONDRIVER_REAL_TOOL_SMOKE_MARKER_20260923\n'
  )
  let application: ElectronApplication | undefined
  try {
    application = await electron.launch({ executablePath: await getElectronForkExecutable(),
      args: ['.', `--user-data-dir=${userDataPath}`],
      cwd: desktopRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        HOME: join(temporaryProfile, 'home'),
        ACTIONDRIVER_E2E_HOME_DIRECTORY: join(temporaryProfile, 'home')
      }
    })
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await page.getByRole('button', { name: /当前模型/ }).click()
    await page.getByRole('option', { name: 'qwen3.7-max' }).click()
    await page
      .getByLabel('任务描述')
      .fill(
        '请调用 tools_local_command_shell_run：先在当前工作目录写入 SMOKE.md，内容为 ACTIONDRIVER_REAL_TOOL_SMOKE_MARKER_20260923，' +
          '然后读回并准确返回这一行。不要猜测文件内容。'
      )
    await page.getByLabel('发送').click()
    const taskPage = page.getByTestId('e2e/tasks/detail/page#page')
    await expect(taskPage).toBeVisible()
    const taskId = await taskPage.getAttribute('data-task-id')
    expect(taskId).toMatch(/^task-/)
    await expect
      .poll(async () => runtimeTask(page, taskId!).then((task) => task?.status), {
        timeout: 75_000
      })
      .not.toBe('running')
    const persisted = await runtimeTask(page, taskId!)
    expect(persisted?.messages.at(-1)?.content).toContain(
      'ACTIONDRIVER_REAL_TOOL_SMOKE_MARKER_20260923'
    )
  } finally {
    await application?.close()
    rmSync(temporaryProfile, { recursive: true, force: true })
  }
})
