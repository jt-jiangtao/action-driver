import { getElectronForkExecutable } from './support/electron-fork'
import { expect, test, _electron as electron } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url))

test('collapses fully and restores from Home and browser-only task view', async () => {
  const application = await electron.launch({ executablePath: await getElectronForkExecutable(), args: [mainEntry] })
  try {
    const page = await application.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.getByRole('button', { name: '折叠侧栏' })).toBeVisible()

    await page.getByRole('button', { name: '折叠侧栏' }).click()
    await expect(page.getByTestId('e2e/shared/sidebar/root#nav')).toHaveCount(0)
    const homeRestore = page.getByRole('button', { name: '展开侧栏' })
    await expect(homeRestore).toBeVisible()
    expect((await homeRestore.boundingBox())!.x).toBeGreaterThanOrEqual(80)
    await homeRestore.click()
    await expect(page.getByTestId('e2e/shared/sidebar/root#nav')).toBeVisible()

    await page.getByRole('button', { name: /预订周末去杭州的酒店/ }).click()
    await expect(page.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
    await page.getByRole('button', { name: '折叠侧栏' }).click()
    await page.getByRole('button', { name: '放大浏览器' }).click()
    await expect(page.getByRole('button', { name: '展开侧栏' })).toHaveCount(1)
    await page.getByRole('button', { name: '展开侧栏' }).click()

    await expect(page.getByTestId('e2e/shared/sidebar/root#nav')).toBeVisible()
    await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'browser-expanded'
    )
  } finally {
    await application.close()
  }
})
