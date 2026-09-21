import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url))
const artifact = (name: string) =>
  fileURLToPath(new URL(`../../../design/actual/${name}.png`, import.meta.url))

let application: ElectronApplication | undefined

async function launch(viewport = { width: 1440, height: 900 }) {
  application = await electron.launch({ args: [mainEntry] })
  const page = await application.firstWindow()
  await page.setViewportSize(viewport)
  return page
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: artifact(name), scale: 'css' })
}

async function expectInsideViewport(page: Page, selector: ReturnType<Page['locator']>) {
  const box = await selector.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)
}

test.afterEach(async () => {
  await application?.close()
  application = undefined
})

test('captures all Home and Task Figma states through public controls', async () => {
  const page = await launch()

  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  await expect(page.getByTestId('e2e/home/main/composer#section')).toHaveCSS('width', '720px')
  await capture(page, 'home-default')
  await expect(page).toHaveScreenshot('home-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  const modelTrigger = page.getByRole('button', { name: /当前模型/ })
  await modelTrigger.click()
  await expect(page.getByRole('listbox', { name: '选择模型' })).toBeVisible()
  await capture(page, 'home-model-selecting')
  await page.getByRole('option', { name: 'gpt-4.1' }).click()
  await expect(modelTrigger).toContainText('gpt-4.1')

  await page.getByLabel('任务描述').fill('帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。')
  await page.getByLabel('发送').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
  await expect(page.getByTestId('e2e/shared/sidebar/root#nav')).toHaveCSS('width', '248px')
  await expect(page.getByTestId('e2e/tasks/detail/agent#section')).toHaveCSS('width', '536px')
  await expect(page.getByTestId('e2e/tasks/detail/browser#section')).toHaveCSS('width', '656px')
  await capture(page, 'task-split')
  await expect(page).toHaveScreenshot('task-split-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  await page.getByRole('button', { name: /当前模型/ }).click()
  await capture(page, 'task-model-selecting')
  await page.keyboard.press('Escape')

  await page.getByText('暂停', { exact: true }).click()
  await expect(page.getByText('Browser Skill · 已暂停')).toBeVisible()
  await page.getByText('继续 Agent').click()
  await expect(page.getByText('Browser Skill · 运行中')).toBeVisible()
  await page.getByText('人工接管', { exact: true }).click()
  await expect(page.getByText('Browser Skill · 人工接管中')).toBeVisible()
  await page.getByText('继续 Agent').click()

  await page.getByLabel('放大浏览器').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'browser-expanded')
  await capture(page, 'task-browser-expanded')
  await expect(page).toHaveScreenshot('task-browser-expanded-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  await page.getByLabel('缩小浏览器').click()
  await page.getByLabel('折叠浏览器').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'browser-collapsed')
  await capture(page, 'task-browser-collapsed')
  await expect(page).toHaveScreenshot('task-browser-collapsed-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  await page.getByLabel('展开浏览器').click()
  await page.getByRole('button', { name: '整理产品研究资料' }).click()
  await expect(page.getByText('归纳关键洞察')).toBeVisible()
  await expect(page.getByText('产品研究资料库')).toBeVisible()
  await page.getByRole('button', { name: '比较三款显示器' }).click()
  await expect(page.getByText('核对接口规格')).toBeVisible()
  await expect(page.getByText('显示器参数比较')).toBeVisible()
})

test('captures all eight Settings Figma states through public controls', async () => {
  const page = await launch()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByTestId('e2e/settings/model-connections/page#page')).toBeVisible()
  await capture(page, 'settings-populated')

  await page.getByRole('button', { name: '公司模型网关的更多操作' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await capture(page, 'settings-menu-open')
  await page.getByRole('button', { name: '公司模型网关的更多操作' }).click()

  await page.getByRole('button', { name: '添加模型集' }).click()
  const dialog = page.getByRole('dialog', { name: '添加模型集' })
  await expect(dialog).toHaveAttribute('data-view-state', 'connection-idle')
  await capture(page, 'settings-connection-form')

  await dialog.getByLabel('名称').fill('研发模型服务')
  await dialog.getByLabel('接口地址').fill('https://models.example.com/v1')
  await dialog.getByLabel('API 密钥').fill('sk-mock')
  await dialog.getByRole('button', { name: '测试连接' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'connection-success')
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'models-untested')
  await capture(page, 'settings-models-untested')

  await dialog.getByRole('button', { name: '测试全部模型' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
  await capture(page, 'settings-models-testing')
  await expect(dialog).toHaveAttribute('data-view-state', 'models-success')
  await capture(page, 'settings-models-success')

  await dialog.getByRole('button', { name: '手动添加模型' }).click()
  await expect(dialog.getByLabel('手动模型名称')).toBeVisible()
  await dialog.getByRole('button', { name: '测试全部模型' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
  await expect(dialog).toHaveAttribute('data-view-state', 'models-partial-failure')
  await expect(dialog.getByText('失败')).toBeVisible()
  await capture(page, 'settings-models-partial-failure')
  await dialog.getByRole('button', { name: '关闭' }).click()

  for (const connectionName of ['公司模型网关', 'Anthropic 生产连接']) {
    await page.getByRole('button', { name: `${connectionName}的更多操作` }).click()
    await page.getByRole('menuitem', { name: '删除模型集' }).click()
    const confirmation = page.getByRole('dialog', { name: '删除模型集' })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText(connectionName)).toHaveCount(0)
  }
  await expect(page.getByText('还没有模型集')).toBeVisible()
  await capture(page, 'settings-empty')
})

test('keeps primary controls reachable at the 1024x700 minimum window', async () => {
  const page = await launch({ width: 1024, height: 700 })
  await expectInsideViewport(page, page.getByRole('button', { name: /当前模型/ }))
  await expectInsideViewport(page, page.getByLabel('发送'))

  await page.getByRole('button', { name: '预订周末去杭州的酒店' }).click()
  const agent = await page.getByTestId('e2e/tasks/detail/agent#section').boundingBox()
  const browser = await page.getByTestId('e2e/tasks/detail/browser#section').boundingBox()
  expect(agent).not.toBeNull()
  expect(browser).not.toBeNull()
  expect(agent!.x + agent!.width).toBeLessThanOrEqual(browser!.x + 0.5)
  await expectInsideViewport(page, page.locator('.browser-skill-controls'))
  await expectInsideViewport(page, page.getByLabel('折叠浏览器'))

  await page.getByRole('button', { name: '设置' }).click()
  await expectInsideViewport(page, page.getByRole('button', { name: '添加模型集' }))
  await page.getByRole('button', { name: '添加模型集' }).click()
  await expectInsideViewport(page, page.getByRole('dialog', { name: '添加模型集' }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await capture(page, 'minimum-window')
})
