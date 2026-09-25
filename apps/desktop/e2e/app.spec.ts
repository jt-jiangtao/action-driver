import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { auditRenderedInteractions as auditPageInteractions } from './interaction-audit'
import type { InteractionContract } from './interaction-audit'

const mainEntry = fileURLToPath(new URL('../out/main/index.js', import.meta.url))
const contracts = JSON.parse(
  readFileSync(fileURLToPath(new URL('./interaction-contracts.json', import.meta.url)), 'utf8')
) as InteractionContract[]
const expectedVisualTargets = contracts
  .filter(({ coverage }) => coverage === 'visual-only')
  .map(({ target }) => target)
const seenVisualTargets = new Set<string>()

async function auditRenderedInteractions(
  page: Page,
  manifest: InteractionContract[],
  expectedTargets: string[] = []
) {
  const result = await auditPageInteractions(page, manifest, expectedTargets)
  for (const target of result.renderedTargets) {
    if (expectedVisualTargets.includes(target)) seenVisualTargets.add(target)
  }
  return result
}
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
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

test.afterAll(() => {
  expect([...seenVisualTargets].sort()).toEqual([...expectedVisualTargets].sort())
})

test('captures all Home and Task Figma states through public controls', async () => {
  const page = await launch()

  expect(await application!.evaluate(({ app }) => app.getName())).toBe('ActionDriver')
  await expect(page).toHaveTitle('ActionDriver')
  await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  await auditRenderedInteractions(page, contracts, [
    'e2e/home/main/composer#section',
    'e2e/shared/sidebar/root#nav',
    'e2e/shared/sidebar/search#button',
    'e2e/shared/sidebar/skills#button',
    'e2e/shared/sidebar/mcp#button',
    'e2e/shared/composer/add#button'
  ])
  await expect(page.getByTestId('e2e/home/main/composer#section')).toHaveCSS('width', '720px')
  await capture(page, 'home-default')
  await expect(page).toHaveScreenshot('home-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  const modelTrigger = page.getByRole('button', { name: /当前模型/ })
  await modelTrigger.click()
  await expect(page.getByRole('listbox', { name: '选择模型' })).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'home-model-selecting')
  await page.getByRole('option', { name: 'gpt-5.2-mini' }).click()
  await expect(modelTrigger).toContainText('gpt-5.2-mini')

  await page.getByLabel('任务描述').fill('帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。')
  await page.getByLabel('发送').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
  await expect(page.getByTestId('e2e/shared/sidebar/root#nav')).toHaveCSS('width', '248px')
  await expect(page.getByTestId('e2e/tasks/detail/agent#section')).toHaveCSS('width', '536px')
  await expect(page.getByTestId('e2e/tasks/detail/browser#section')).toHaveCSS('width', '656px')
  await auditRenderedInteractions(page, contracts, [
    'e2e/tasks/detail/page#page',
    'e2e/tasks/detail/agent#section',
    'e2e/tasks/detail/browser#section',
    'e2e/tasks/detail/browser/back#button',
    'e2e/tasks/detail/browser/forward#button',
    'e2e/tasks/detail/browser/refresh#button',
    'e2e/tasks/detail/browser/new-tab#button'
  ])
  await capture(page, 'task-split')
  await expect(page).toHaveScreenshot('task-split-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  await page.getByRole('button', { name: /当前模型/ }).click()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'task-model-selecting')
  await page.keyboard.press('Escape')

  await page.getByText('暂停', { exact: true }).click()
  await expect(page.getByText('Browser Skill · 已暂停')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await page.getByText('继续 Agent').click()
  await expect(page.getByText('Browser Skill · 运行中')).toBeVisible()
  await page.getByText('人工接管', { exact: true }).click()
  await expect(page.getByText('Browser Skill · 人工接管中')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await page.getByText('继续 Agent').click()

  await page.getByLabel('放大浏览器').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
    'data-mode',
    'browser-expanded'
  )
  await auditRenderedInteractions(page, contracts, ['e2e/tasks/detail/browser/menu#button'])
  await capture(page, 'task-browser-expanded')
  await expect(page).toHaveScreenshot('task-browser-expanded-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  await page.getByLabel('缩小浏览器').click()
  await page.getByLabel('折叠浏览器').click()
  await expect(page.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
    'data-mode',
    'browser-collapsed'
  )
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'task-browser-collapsed')
  await expect(page).toHaveScreenshot('task-browser-collapsed-1440x900.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02
  })

  await page.getByLabel('展开浏览器').click()
  await page.getByRole('button', { name: '整理产品研究资料' }).click()
  await expect(page.getByRole('region', { name: '任务过程' })).toBeVisible()
  await expect(page.getByText('产品研究资料库')).toBeVisible()
  await page.getByRole('button', { name: '比较三款显示器' }).click()
  await expect(page.getByText('显示器参数比较')).toBeVisible()
  await expect(page.getByText('显示器参数比较')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
})

test('captures all eight Settings Figma states through public controls', async () => {
  const page = await launch()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByTestId('e2e/settings/model-connections/page#page')).toBeVisible()
  await expect(page.getByText('公司模型网关')).toBeVisible()
  await auditRenderedInteractions(page, contracts, [
    'e2e/settings/model-connections/page#page',
    'e2e/settings/sidebar/search#input',
    'e2e/settings/sidebar/model-connections#button'
  ])
  await capture(page, 'settings-populated')

  await page.getByTestId('e2e/settings/sidebar/main-prompt#button').click()
  await expect(page.getByTestId('e2e/settings/main-prompt/page#page')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-main-prompt')
  await page.getByTestId('e2e/settings/main-prompt/restore#button').click()
  await expect(page.getByRole('dialog', { name: '恢复默认主提示词？' })).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-main-prompt-restore')
  await page.getByTestId('e2e/settings/main-prompt/restore-cancel#button').click()
  await page.getByTestId('e2e/settings/agent-editors/main-prompt/mode/source#button').click()
  await expect(
    page.getByTestId('e2e/settings/agent-editors/main-prompt/source#section')
  ).toBeVisible()
  await expect(page.locator('.agent-monaco-editor .monaco-editor')).toBeVisible()
  await page.getByRole('textbox', { name: '主提示词 Markdown 源码' }).focus()
  await page.keyboard.press('Meta+A')
  await page.keyboard.insertText('# 更新后的主提示词\n\n保持回答简洁。')
  await expect(page.getByTestId('e2e/settings/agent-editors/main-prompt/save#button')).toBeEnabled()
  await page.getByTestId('e2e/settings/agent-editors/main-prompt/mode/edit#button').click()
  await expect(page.getByRole('heading', { name: '更新后的主提示词', level: 1 })).toBeVisible()
  await capture(page, 'settings-main-prompt-dirty')

  await page.getByTestId('e2e/settings/sidebar/skills#button').click()
  await expect(page.getByRole('dialog', { name: '离开主提示词？' })).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-main-prompt-leave')
  await page.getByTestId('e2e/settings/main-prompt/leave-cancel#button').click()
  await page.getByTestId('e2e/settings/sidebar/skills#button').click()
  await page.getByTestId('e2e/settings/main-prompt/discard-leave#button').click()
  await expect(page.getByTestId('e2e/settings/skills/page#page')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-skills-list')
  await page.getByTestId('e2e/settings/skills/create#button').click()
  await expect(page.getByRole('dialog', { name: '新建 Skill' })).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-skill-create')
  await page.getByTestId('e2e/settings/skills/dialog/cancel#button').click()
  await page.getByTestId('e2e/settings/skills/items/browser-tools#button').click()
  await expect(page.getByRole('tree', { name: 'Skill 文件' })).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-skill-detail')
  await page.getByTestId('e2e/settings/skills/detail/actions#button').click()
  await expect(page.getByRole('menu')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-skill-actions')
  await page.getByTestId('e2e/settings/skills/detail/back#button').click()

  await expect(page.getByTestId('e2e/settings/sidebar/logs#button')).toHaveCount(0)
  await expect(page.getByTestId('e2e/settings/sidebar/model-connections#button')).toBeVisible()
  await page.getByTestId('e2e/settings/sidebar/model-connections#button').click()
  await expect(page.getByTestId('e2e/settings/model-connections/page#page')).toBeVisible()

  await page.getByRole('button', { name: '公司模型网关的更多操作' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-menu-open')
  await page.getByRole('button', { name: '公司模型网关的更多操作' }).click()

  await page.getByRole('button', { name: '添加模型集' }).click()
  const dialog = page.getByRole('dialog', { name: '添加模型集' })
  await expect(dialog).toHaveAttribute('data-view-state', 'connection-idle')
  await auditRenderedInteractions(page, contracts, ['e2e/settings/add-model-set/dialog#dialog'])
  await capture(page, 'settings-connection-form')

  await dialog.getByLabel('名称').fill('研发模型服务')
  await dialog.getByLabel('接口地址').fill('https://models.example.com/v1')
  await dialog.getByLabel('API 密钥').fill('sk-mock')
  await dialog.getByRole('button', { name: '测试连接' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'connection-success')
  await dialog.getByRole('button', { name: '下一步' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'models-untested')
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-models-untested')

  await dialog.getByRole('button', { name: '测试全部模型' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-models-testing')
  await expect(dialog).toHaveAttribute('data-view-state', 'models-success')
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-models-success')

  await dialog.getByRole('button', { name: '手动添加模型' }).click()
  await expect(dialog.getByLabel('手动模型名称')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await dialog.getByRole('button', { name: '测试全部模型' }).click()
  await expect(dialog).toHaveAttribute('data-view-state', 'models-testing')
  await expect(dialog).toHaveAttribute('data-view-state', 'models-partial-failure')
  await expect(dialog.getByText('失败')).toBeVisible()
  await auditRenderedInteractions(page, contracts)
  await capture(page, 'settings-models-partial-failure')
  await dialog.getByRole('button', { name: '关闭' }).click()

  for (const connectionName of ['公司模型网关', 'Anthropic 生产连接']) {
    await page.getByRole('button', { name: `${connectionName}的更多操作` }).click()
    await page.getByRole('menuitem', { name: '删除模型集' }).click()
    const confirmation = page.getByRole('dialog', { name: '删除模型集' })
    await expect(confirmation).toBeVisible()
    await auditRenderedInteractions(page, contracts)
    await confirmation.getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText(connectionName)).toHaveCount(0)
  }
  await expect(page.getByText('还没有模型集')).toBeVisible()
  await auditRenderedInteractions(page, contracts, [
    'e2e/settings/model-connections/empty/protocols#link'
  ])
  await capture(page, 'settings-empty')
})

test('keeps primary controls reachable at the 1024x700 minimum window', async () => {
  const page = await launch({ width: 1024, height: 700 })
  await expectInsideViewport(page, page.getByRole('button', { name: /当前模型/ }))
  await expectInsideViewport(page, page.getByLabel('发送'))
  await auditRenderedInteractions(page, contracts)

  await page.getByRole('button', { name: '预订周末去杭州的酒店' }).click()
  const agent = await page.getByTestId('e2e/tasks/detail/agent#section').boundingBox()
  const browser = await page.getByTestId('e2e/tasks/detail/browser#section').boundingBox()
  expect(agent).not.toBeNull()
  expect(browser).not.toBeNull()
  expect(agent!.x + agent!.width).toBeLessThanOrEqual(browser!.x + 0.5)
  await expectInsideViewport(page, page.locator('.browser-skill-controls'))
  await expectInsideViewport(page, page.getByLabel('折叠浏览器'))
  await auditRenderedInteractions(page, contracts)

  await page.getByRole('button', { name: '设置' }).click()
  await expectInsideViewport(page, page.getByRole('button', { name: '添加模型集' }))
  await expectInsideViewport(page, page.getByRole('button', { name: '刷新并测试公司模型网关' }))
  await expectInsideViewport(page, page.getByRole('button', { name: '测试gpt-5.2', exact: true }))
  await page.getByTestId('e2e/settings/sidebar/skills#button').click()
  await expectInsideViewport(page, page.getByTestId('e2e/settings/skills/create#button'))
  await expectInsideViewport(page, page.getByTestId('e2e/settings/skills/search#input'))
  await page.getByTestId('e2e/settings/sidebar/model-connections#button').click()
  await page.getByRole('button', { name: '添加模型集' }).click()
  await expectInsideViewport(page, page.getByRole('dialog', { name: '添加模型集' }))
  await auditRenderedInteractions(page, contracts)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true)
  await capture(page, 'minimum-window')
})
