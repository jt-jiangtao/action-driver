import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createRendererContainer, resolveAppServices } from './di/container'
import { AppServicesProvider } from './di/services-context'
import { MockModelConnectionsService } from './services/mock-model-connections'

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

    await user.click(await screen.findByLabelText('放大浏览器'))
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

    await user.click(await screen.findByText('新任务'))
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: /预订周末去杭州的酒店/ }))

    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
  })

  it('opens different recent tasks through the shared task page', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '整理产品研究资料' }))
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

  it('loads persisted models and tasks, then submits the exact selected model reference', async () => {
    const user = userEvent.setup()
    const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))
    const completedTask = {
      id: 'real-task',
      title: '真实模型回答',
      status: 'succeeded' as const,
      messages: [
        { id: 'real-user', role: 'user' as const, content: 'return result' },
        { id: 'real-agent', role: 'agent' as const, content: '## 已完成\n\n这是**真实响应**。' }
      ],
      steps: [],
      browser: null
    }
    const submitGoal = vi.fn(async () => completedTask)
    services.modelConnectionsService = new MockModelConnectionsService({
      delayMs: 0,
      seed: [{
        id: 'real-gateway',
        name: '真实网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://real.example/v1',
        apiKeyHint: '••••real',
        expanded: true,
        models: [{ id: 'real-model', name: 'real-model', enabled: true, testState: 'success' }]
      }]
    })
    services.taskCatalog = {
      listRecentTasks: async () => [{ id: 'persisted-task', title: '持久化任务', state: 'default' }],
      getTask: async () => null
    }
    services.agentCommandService = {
      submitGoal,
      interrupt: async () => undefined,
      continueTask: async () => undefined
    }

    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )

    expect(await screen.findByRole('button', { name: '持久化任务' })).toBeVisible()
    expect(await screen.findByRole('button', { name: /真实网关 \/ real-model/ })).toBeVisible()
    const editor = screen.getByLabelText('任务描述')
    editor.textContent = 'return result'
    fireEvent.input(editor)
    await user.click(screen.getByLabelText('发送'))

    expect(submitGoal).toHaveBeenCalledWith({
      goal: 'return result',
      model: { connectionId: 'real-gateway', modelId: 'real-model' }
    })
    expect(await screen.findByRole('heading', { name: '已完成' })).toBeVisible()
    expect(screen.queryByTestId('e2e/tasks/detail/browser#section')).not.toBeInTheDocument()
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'agent-only')
  })

  it('shows retryable errors without falling back to production mock labels', async () => {
    const user = userEvent.setup()
    const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))
    let rejectModels = true
    let rejectTasks = true
    services.modelConnectionsService = Object.assign(services.modelConnectionsService, {
      list: async () => {
        if (rejectModels) throw new Error('model query failed')
        return [{
          id: 'retry-gateway',
          name: '重试网关',
          protocol: 'openai-compatible',
          baseUrl: 'https://retry.example/v1',
          apiKeyHint: '••••retry',
          expanded: true,
          models: [{ id: 'retry-model', name: 'retry-model', enabled: true, testState: 'success' }]
        }]
      }
    })
    services.taskCatalog = {
      listRecentTasks: async () => {
        if (rejectTasks) throw new Error('task query failed')
        return [{ id: 'retry-task', title: '重试后的任务', state: 'default' }]
      },
      getTask: async () => null
    }

    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('模型加载失败')
    expect(await screen.findByText('任务加载失败')).toBeVisible()
    expect(screen.queryByText('公司模型网关')).not.toBeInTheDocument()
    expect(screen.queryByText('预订周末去杭州的酒店')).not.toBeInTheDocument()

    rejectModels = false
    rejectTasks = false
    await user.click(screen.getByRole('button', { name: '重试' }))
    await user.click(screen.getByRole('button', { name: '重试任务' }))
    expect(await screen.findByRole('button', { name: /重试网关 \/ retry-model/ })).toBeVisible()
    expect(await screen.findByRole('button', { name: '重试后的任务' })).toBeVisible()
  })

  it('clears a model selection disabled in settings and prevents submission', async () => {
    const user = userEvent.setup()
    const services = resolveAppServices(createRendererContainer({ mode: 'mock' }))
    let enabled = true
    const source = new MockModelConnectionsService({
      delayMs: 0,
      seed: [{
        id: 'mutable-gateway',
        name: '可变网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://mutable.example/v1',
        apiKeyHint: '••••mutable',
        expanded: true,
        models: [{ id: 'mutable-model', name: 'mutable-model', enabled: true, testState: 'success' }]
      }]
    })
    const listSource = source.list.bind(source)
    services.modelConnectionsService = Object.assign(source, {
      list: async () => [{
        ...(await listSource())[0]!,
        models: [{ id: 'mutable-model', name: 'mutable-model', enabled, testState: 'success' }]
      }]
    })

    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )

    expect(await screen.findByRole('button', { name: /可变网关 \/ mutable-model/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '设置' }))
    enabled = false
    await user.click(screen.getByRole('button', { name: '返回应用' }))

    expect(await screen.findByRole('button', { name: '选择模型' })).toBeVisible()
    expect(screen.getByLabelText('发送')).toBeDisabled()
  })
})
