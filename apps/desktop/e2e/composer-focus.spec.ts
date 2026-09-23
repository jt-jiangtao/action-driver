import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url))

let application: ElectronApplication | undefined

test.afterEach(async () => {
  await application?.close()
  application = undefined
})

test('hovering or focusing the composer removes the visible border', async () => {
  application = await electron.launch({ args: [mainEntry] })
  const page = await application.firstWindow()
  const composer = page.getByTestId('e2e/shared/composer/root#section')

  await composer.hover()
  await expect(composer).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')

  await page.getByLabel('任务描述').click()

  await expect(composer).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')
})

test('conversation list exposes a visible scrollbar when content overflows', async () => {
  application = await electron.launch({ args: [mainEntry] })
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

test('model log detail keeps navigation and payload content in bounded scroll areas', async () => {
  application = await electron.launch({ args: [mainEntry] })
  const page = await application.firstWindow()
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByTestId('e2e/settings/sidebar/logs#button').click()
  await page.getByTestId('e2e/settings/logs/layer/model#button').click()
  await page.getByTestId('e2e/settings/logs/model/sessions/office-assistant#button').click()
  await page.getByTestId('e2e/settings/logs/model/tasks/weather-report#button').click()

  const sectionToggles = page.locator('.model-detail-section > button[aria-expanded="false"]')
  while ((await sectionToggles.count()) > 0) {
    await sectionToggles.first().click()
  }
  const detailSections = page.locator('.model-detail-sections')
  await expect(detailSections.locator('.model-detail-section').first()).toHaveCSS('flex-shrink', '0')
  const detailMetrics = await detailSections.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }))
  expect(detailMetrics.scrollHeight).toBeGreaterThan(detailMetrics.clientHeight)
  await detailSections.hover()
  await page.mouse.wheel(0, 480)
  await expect.poll(() => detailSections.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  await expect(page.locator('.model-call-list')).toHaveCSS('overflow-y', 'auto')
  await expect(detailSections).toHaveCSS('overflow-y', 'scroll')
  for (const list of [page.locator('.model-call-list'), detailSections]) {
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
