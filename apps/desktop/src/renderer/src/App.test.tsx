import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { createRendererContainer, resolveAppServices } from './di/container'
import { AppServicesProvider } from './di/services-context'

function renderApp(initialRoute: 'home' | 'task' | 'settings' | 'main-prompt' | 'skills' = 'home') {
  const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))
  return render(
    <AppServicesProvider services={services}>
      <App initialRoute={initialRoute} />
    </AppServicesProvider>
  )
}

describe('App', () => {
  it('submits the home goal into the mock task without adding extra pages', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await user.type(screen.getByLabelText('任务描述'), '预订杭州酒店')
    await user.click(screen.getByLabelText('发送'))

    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
    expect(screen.getAllByText('预订周末去杭州的酒店')).toHaveLength(2)
  })

  it('switches between split, expanded, and collapsed browser layouts', async () => {
    const user = userEvent.setup()
    renderApp('task')

    await user.click(screen.getByLabelText('放大浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'browser-expanded')
    await user.click(screen.getByLabelText('缩小浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
    await user.click(screen.getByLabelText('折叠浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'browser-collapsed')
    await user.click(screen.getByLabelText('展开浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
  })

  it('reopens the current mock task from Recent Tasks after returning home', async () => {
    const user = userEvent.setup()
    renderApp('task')

    await user.click(screen.getByText('新任务'))
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /预订周末去杭州的酒店/ }))

    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
  })

  it('opens different recent tasks through the shared task page', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: '整理产品研究资料' }))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
    expect(screen.getAllByText('整理产品研究资料')).toHaveLength(2)
    expect(screen.getByText('归纳关键洞察')).toBeVisible()
    expect(screen.getByText('产品研究资料库')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '比较三款显示器' }))
    expect(screen.getAllByText('比较三款显示器')).toHaveLength(2)
    expect(screen.getByText('核对接口规格')).toBeVisible()
    expect(screen.getByText('显示器参数比较')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '整理产品研究资料' })).not.toBeInTheDocument()
  })

  it('keeps inert navigation on the current page', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Skills' }))
    await user.click(screen.getByRole('button', { name: 'MCP' }))
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  })

  it('opens model connection settings and returns to the application', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByTestId('e2e/settings/model-connections/page#page')).toBeVisible()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回应用' }))
    expect(screen.getByTestId('e2e/shared/sidebar/root#nav')).toHaveAttribute('data-width', '248')
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
  })

  it('can start directly on the settings route', () => {
    renderApp('settings')
    expect(screen.getByRole('heading', { name: '模型连接' })).toBeVisible()
  })

  it('navigates across the single settings sidebar without duplicating the shell', async () => {
    const user = userEvent.setup()
    renderApp('settings')

    await user.click(screen.getByRole('button', { name: '主提示词' }))
    expect(await screen.findByTestId('e2e/settings/main-prompt/page#page')).toBeVisible()
    expect(screen.getAllByRole('navigation', { name: '设置导航' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Skills' }))
    expect(await screen.findByTestId('e2e/settings/skills/page#page')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '日志' }))
    expect(await screen.findByTestId('e2e/settings/logs/page#page')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '模型连接' }))
    expect(await screen.findByTestId('e2e/settings/model-connections/page#page')).toBeVisible()
  })
})
