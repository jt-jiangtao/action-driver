import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url))
const artifact = (name: string) =>
  fileURLToPath(new URL(`../../../design/actual/${name}.png`, import.meta.url))

let application: ElectronApplication | undefined

test.afterEach(async () => {
  await application?.close()
  application = undefined
})

test('ActionDriver home, task, and browser layouts', async () => {
  application = await electron.launch({ args: [mainEntry] })
  const page = await application.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })

  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  await expect(page).toHaveScreenshot('home-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })
  await page.screenshot({ path: artifact('home'), scale: 'css' })

  await page.getByLabel('任务描述').fill('帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。')
  await page.getByLabel('发送').click()
  await expect(page.getByTestId('task-page')).toHaveAttribute('data-mode', 'split')
  await expect(page.getByTestId('sidebar')).toHaveCSS('width', '248px')
  await expect(page.getByTestId('agent-panel')).toHaveCSS('width', '536px')
  await expect(page.getByTestId('browser-panel-slot')).toHaveCSS('width', '656px')
  const targetBox = await page.locator('.browser-target').boundingBox()
  expect(targetBox).toMatchObject({ x: 930, y: 266, width: 220, height: 52 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.browser-target')).toHaveCSS('animation-name', 'none')
  expect(await page.locator('.browser-target').boundingBox()).toEqual(targetBox)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const controlsBox = await page.locator('.browser-skill-controls').boundingBox()
  expect(controlsBox).toMatchObject({ x: 925.5, width: 373, height: 48 })
  await expect(page).toHaveScreenshot('task-split-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })
  await page.screenshot({ path: artifact('task-split'), scale: 'css' })

  await page.getByText('暂停', { exact: true }).click()
  await expect(page.getByText('Browser Skill · 已暂停')).toBeVisible()
  await page.getByText('继续 Agent').click()
  await expect(page.getByText('Browser Skill · 运行中')).toBeVisible()
  await page.getByText('人工接管', { exact: true }).click()
  await expect(page.getByText('Browser Skill · 人工接管中')).toBeVisible()
  await page.getByText('继续 Agent').click()

  await page.getByLabel('放大浏览器').click()
  await expect(page.getByTestId('task-page')).toHaveAttribute('data-mode', 'browser-expanded')
  await expect(page).toHaveScreenshot('task-browser-expanded-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })
  await page.screenshot({ path: artifact('task-browser-expanded'), scale: 'css' })

  await page.getByLabel('缩小浏览器').click()
  await page.getByLabel('折叠浏览器').click()
  await expect(page.getByTestId('task-page')).toHaveAttribute('data-mode', 'browser-collapsed')
  await expect(page).toHaveScreenshot('task-browser-collapsed-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })
  await page.screenshot({ path: artifact('task-browser-collapsed'), scale: 'css' })

  await page.getByLabel('展开浏览器').click()
  await expect(page.getByTestId('task-page')).toHaveAttribute('data-mode', 'split')
})
