import { getElectronForkExecutable } from './support/electron-fork'
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url))

let application: ElectronApplication | undefined

test.afterEach(async () => {
  await application?.close()
  application = undefined
})

test('hovering or focusing the composer removes the visible border', async () => {
  application = await electron.launch({ executablePath: await getElectronForkExecutable(), args: [mainEntry] })
  const page = await application.firstWindow()
  const composer = page.getByTestId('e2e/shared/composer/root#section')

  await composer.hover()
  await expect(composer).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')

  await page.getByLabel('任务描述').click()

  await expect(composer).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')
})

test('conversation list exposes a visible scrollbar when content overflows', async () => {
  application = await electron.launch({ executablePath: await getElectronForkExecutable(), args: [mainEntry] })
  const page = await application.firstWindow()
  await page.getByRole('button', { name: '整理产品研究资料' }).click()
  const recentTasks = page.locator('.recent-task-list')
  await recentTasks.evaluate((element) => {
    const seed = element.querySelector('button')
    if (!seed) throw new Error('A recent-task button is required for the overflow fixture')
    for (let index = 0; index < 32; index += 1) {
      const clone = seed.cloneNode(true) as HTMLElement
      clone.textContent = `溢出任务 ${index + 1}`
      element.append(clone)
    }
  })
  const recentTaskMetrics = await recentTasks.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    appRegion: getComputedStyle(element).getPropertyValue('-webkit-app-region')
  }))
  expect(recentTaskMetrics.scrollHeight).toBeGreaterThan(recentTaskMetrics.clientHeight)
  expect(recentTaskMetrics.appRegion).toBe('no-drag')
  await expect(recentTasks.locator('.recent-task').first()).toHaveCSS('flex-shrink', '0')
  await recentTasks.hover()
  await page.mouse.wheel(0, 480)
  await expect.poll(() => recentTasks.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  for (const list of [page.locator('.conversation-scroll'), recentTasks]) {
    await expect(list).toHaveCSS('overflow-y', 'auto')
    const scrollbarWidth = await list.evaluate(
      (element) => getComputedStyle(element, '::-webkit-scrollbar').width
    )
    const thumbColor = await list.evaluate(
      (element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor
    )
    expect(scrollbarWidth).toBe('8px')
    expect(thumbColor).not.toBe('rgba(0, 0, 0, 0)')
  }
})

test('mock mode has no in-app observability navigation or model logs', async () => {
  application = await electron.launch({ executablePath: await getElectronForkExecutable(), args: [mainEntry] })
  const page = await application.firstWindow()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByTestId('e2e/settings/sidebar/logs#button')).toHaveCount(0)
  await expect(page.locator('.model-detail-sections')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'LangSmith 模型日志详情' })).toHaveCount(0)
})
