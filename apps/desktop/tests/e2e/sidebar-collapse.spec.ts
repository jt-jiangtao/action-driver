import { getElectronForkExecutable } from './support/electron-fork'
import { expect, test, _electron as electron, chromium } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const mainEntry = fileURLToPath(new URL('../../out/main/index.js', import.meta.url))

test('collapses fully and restores from Home and browser-only task view', async () => {
  const application = await electron.launch({
    executablePath: await getElectronForkExecutable(),
    args: [mainEntry]
  })
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

test('keeps application controls fixed across sidebar and settings transitions', async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files']
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(
      pathToFileURL(fileURLToPath(new URL('../../out/renderer/index.html', import.meta.url))).href
    )
    const position = async (name: string) => {
      const box = await page.getByRole('button', { name }).boundingBox()
      expect(box).not.toBeNull()
      return { x: box!.x, y: box!.y }
    }
    const back = await position('应用后退')
    const toggle = await position('折叠侧栏')
    const backBox = await page.getByRole('button', { name: '应用后退' }).boundingBox()
    expect(backBox).not.toBeNull()
    expect(backBox!.width).toBe(28)
    expect(backBox!.height).toBe(28)
    expect(backBox!.y + backBox!.height / 2).toBe(22)
    expect(
      await page
        .locator('.sidebar-window-row')
        .evaluate((item) => getComputedStyle(item).getPropertyValue('-webkit-app-region'))
    ).toBe('drag')
    expect(
      await page
        .getByRole('button', { name: '应用后退' })
        .evaluate((item) => getComputedStyle(item).getPropertyValue('-webkit-app-region'))
    ).toBe('no-drag')
    await page.getByRole('button', { name: '折叠侧栏' }).click()
    expect(await position('应用后退')).toEqual(back)
    expect(await position('展开侧栏')).toEqual(toggle)
    await page.getByRole('button', { name: '展开侧栏' }).click()
    await page.getByRole('button', { name: '设置' }).click()
    expect(await position('应用后退')).toEqual(back)
    expect(
      await page
        .locator('.settings-drag-space')
        .evaluate((item) => getComputedStyle(item).getPropertyValue('-webkit-app-region'))
    ).toBe('drag')

    const backgrounds = await page
      .locator('.settings-drag-space, .settings-main-topbar')
      .evaluateAll((items) =>
        items.map((item) => ({
          height: item.getBoundingClientRect().height,
          color: getComputedStyle(item).backgroundColor
        }))
      )
    expect(backgrounds).toEqual([
      { height: 44, color: 'rgb(247, 247, 248)' },
      { height: 44, color: 'rgb(247, 247, 248)' }
    ])
    await page.getByRole('button', { name: '返回应用' }).click()
    await page.getByRole('button', { name: /预订周末去杭州的酒店/ }).click()
    const taskTopbars = await page
      .locator('.sidebar-window-row, .task-header, .browser-tabbar')
      .evaluateAll((items) =>
        items.map((item) => ({
          height: item.getBoundingClientRect().height,
          color: getComputedStyle(item).backgroundColor
        }))
      )
    expect(taskTopbars).toEqual([
      { height: 44, color: 'rgb(247, 247, 248)' },
      { height: 44, color: 'rgb(247, 247, 248)' },
      { height: 44, color: 'rgb(247, 247, 248)' }
    ])
    await page.getByRole('button', { name: '折叠侧栏' }).click()
    await page.getByRole('button', { name: '放大浏览器' }).click()
    expect(await position('展开侧栏')).toEqual(toggle)
    await page.setViewportSize({ width: 1024, height: 700 })
    expect(await position('应用后退')).toEqual(back)
    const browserContent = await page.locator('.browser-content').boundingBox()
    expect(browserContent).not.toBeNull()
    expect(browserContent!.width).toBeGreaterThan(0)
    expect(browserContent!.height).toBeGreaterThan(0)
    expect(browserContent!.x + browserContent!.width).toBeLessThanOrEqual(1024)
    expect(browserContent!.y + browserContent!.height).toBeLessThanOrEqual(700)
  } finally {
    await browser.close()
  }
})
