import { getElectronForkExecutable } from './support/electron-fork'
import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('../..', import.meta.url))

test('主提示词源码在 Monaco CDN 不可用时仍显示内容', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'action-driver-monaco-e2e-'))
  const homeDirectory = mkdtempSync(join(tmpdir(), 'action-driver-monaco-home-'))
  const application = await electron.launch({ executablePath: await getElectronForkExecutable(),
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: homeDirectory,
      ACTION_DRIVER_E2E_HOME_DIRECTORY: homeDirectory
    }
  })
  try {
    const page = await application.firstWindow()
    const remoteMonacoRequests: string[] = []
    await page.route('https://cdn.jsdelivr.net/**', (route) => {
      remoteMonacoRequests.push(route.request().url())
      return route.abort()
    })

    await page.getByRole('button', { name: '设置' }).click()
    await page.getByTestId('e2e/settings/sidebar/main-prompt#button').click()
    await expect(page.getByRole('heading', { name: 'Action-Driver 主提示词' })).toBeVisible()
    await page.getByTestId('e2e/settings/agent-editors/main-prompt/mode/source#button').click()

    await expect(page.locator('.agent-monaco-editor .view-lines')).toContainText(
      'Action-Driver 主提示词',
      { timeout: 5_000 }
    )
    await page.getByRole('textbox', { name: '主提示词 Markdown 源码' }).focus()
    await page.keyboard.press('Meta+A')
    await page.keyboard.insertText('# 离线编辑成功')
    await expect(
      page.getByTestId('e2e/settings/agent-editors/main-prompt/save#button')
    ).toBeEnabled()
    expect(remoteMonacoRequests).toEqual([])
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
    rmSync(homeDirectory, { recursive: true, force: true })
  }
})
