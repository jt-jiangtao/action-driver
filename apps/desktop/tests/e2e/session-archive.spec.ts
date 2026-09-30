import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getElectronForkExecutable } from './support/electron-fork'

const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))

test('archives, searches and restores a chat in the desktop shell', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'action-driver-session-archive-'))
  const application = await electron.launch({
    executablePath: await getElectronForkExecutable(),
    args: [mainEntry, `--user-data-dir=${userDataDirectory}`]
  })
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('e2e/shared/sidebar/tasks/research-task#button').hover()
    await expect(page.getByRole('button', { name: '置顶' })).toHaveCount(0)
    await page.getByTestId('e2e/shared/sidebar/tasks/research-task/archive#button').click()
    await expect(page.getByTestId('e2e/shared/sidebar/tasks/research-task#button')).toHaveCount(0)
    await expect(page.getByRole('status', { name: '已归档的聊天' })).toBeVisible()
    await page.getByTestId('e2e/shared/archive-toast/view#button').click()
    await page.getByTestId('e2e/settings/archived/search#input').fill('研究')
    await expect(page.getByTestId('e2e/settings/archived/research-task/open#button')).toBeVisible()
    await page.getByTestId('e2e/settings/archived/research-task/restore#button').click()
    await expect(page.getByTestId('e2e/settings/archived/research-task/open#button')).toHaveCount(0)
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
