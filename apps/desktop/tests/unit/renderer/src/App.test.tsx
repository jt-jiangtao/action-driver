import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../../../src/renderer/src/App'
import { createRendererServices } from '../../../../src/renderer/src/di/container'
import { AppServicesProvider } from '../../../../src/renderer/src/di/services-context'
import { MockModelConnectionsService } from '../../../../src/renderer/src/services/mock-model-connections'

function renderApp(
  initialRoute: 'home' | 'task' | 'settings' | 'main-prompt' | 'skills' | 'computer-use' = 'home'
) {
  const services = createRendererServices({ mode: 'mock' })
  return render(
    <AppServicesProvider services={services}>
      <App initialRoute={initialRoute} />
    </AppServicesProvider>
  )
}

describe('App', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('shares the model connection query across home and settings navigation', async () => {
    const user = userEvent.setup()
    const services = createRendererServices({ mode: 'mock' })
    const list = vi.spyOn(services.modelConnectionsService, 'list')
    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )
    await screen.findByText('我们应该在 Action-Driver 中做些什么？')
    await screen.findByRole('button', { name: '设置' })
    await user.click(screen.getByRole('button', { name: '设置' }))
    await screen.findByText('公司模型网关')
    await user.click(screen.getByRole('button', { name: '返回应用' }))
    expect(list).toHaveBeenCalledOnce()
  })

  it('restores the current task, title and messages after the renderer remounts', async () => {
    const first = renderApp('task')
    await screen.findByTestId('e2e/tasks/detail/page#page')
    first.unmount()

    renderApp()
    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-task-id',
      'hotel-task'
    )
    expect(screen.getByRole('button', { name: /预订周末去杭州的酒店/ })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      screen.getByText('帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。')
    ).toBeVisible()
  })

  it('restores the active task even when the recent-task list fails to load', async () => {
    const services = createRendererServices({ mode: 'mock' })
    const getTask = services.taskCatalog.getTask.bind(services.taskCatalog)
    services.taskCatalog = {
      listRecentTasks: async () => {
        throw new Error('recent list unavailable')
      },
      getTask
    }
    sessionStorage.setItem('action-driver.active-task-id', 'hotel-task')

    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )

    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-task-id',
      'hotel-task'
    )
    expect(
      screen.getByText('帮我预订本周六到周日，杭州西湖附近评分 4.5 以上的酒店。')
    ).toBeVisible()
  })

  it('submits the home goal into the mock task without adding extra pages', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(screen.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
    await user.type(screen.getByLabelText('任务描述'), '预订杭州酒店')
    await user.click(screen.getByLabelText('发送'))

    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'split'
    )
    expect(screen.getAllByText('预订周末去杭州的酒店')).toHaveLength(2)
  })

  it('stages image-only input and passes asset IDs to the stream command', async () => {
    const user = userEvent.setup()
    const services = createRendererServices({ mode: 'mock' })
    const uploadImage = vi.fn(async () => ({
      assetId: 'staged-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'upload' as const
    }))
    services.imageAssets = { uploadImage, readImage: vi.fn() }
    const submit = vi.spyOn(services.agentCommandService, 'submitGoal')
    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )
    await screen.findByText('我们应该在 Action-Driver 中做些什么？')
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('添加图片'), image)
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toBeVisible()
    expect(uploadImage).toHaveBeenCalledWith(image)
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ goal: '', imageAssetIds: ['staged-1'] })
    )
  })

  it('stages documents and images as session input files for the next task', async () => {
    const user = userEvent.setup()
    const services = createRendererServices({ mode: 'mock' })
    const uploadImage = vi.fn(async () => ({
      assetId: 'staged-image',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'upload' as const
    }))
    const uploadInputFile = vi.fn(async (file: File) => ({
      fileId: `file:${file.name}`,
      name: file.name,
      mimeType: file.type,
      byteLength: file.size
    }))
    services.imageAssets = { uploadImage, readImage: vi.fn() }
    services.inputFiles = { uploadInputFile }
    const submit = vi.spyOn(services.agentCommandService, 'submitGoal')
    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )
    await screen.findByText('我们应该在 Action-Driver 中做些什么？')
    const document = new File(['%PDF-1.7'], '季度报告.pdf', { type: 'application/pdf' })
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择文档'), document)
    await user.upload(screen.getByLabelText('添加图片'), image)
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toBeVisible()
    expect(uploadInputFile).toHaveBeenCalledWith(document)
    expect(uploadInputFile).toHaveBeenCalledWith(image)
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        imageAssetIds: ['staged-image'],
        inputFileIds: ['file:季度报告.pdf', 'file:photo.png']
      })
    )
  })

  it('sends an image with a chat candidate even when its vision test failed', async () => {
    const user = userEvent.setup()
    const services = createRendererServices({ mode: 'mock' })
    services.modelConnectionsService = new MockModelConnectionsService({
      delayMs: 0,
      seed: [
        {
          id: 'text-gateway',
          name: '文本网关',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          apiKeyHint: '••••1234',
          expanded: true,
          models: [
            {
              id: 'text-only',
              name: 'text-only',
              enabled: true,
              testState: 'success',
              capabilities: {
                text: { state: 'success', source: 'probe' },
                vision: { state: 'unsupported', source: 'probe' }
              }
            }
          ]
        }
      ]
    })
    const uploadImage = vi.fn(async () => ({
      assetId: 'staged-vision',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'upload' as const
    }))
    services.imageAssets = { uploadImage, readImage: vi.fn() }
    const submitGoal = vi.spyOn(services.agentCommandService, 'submitGoal')
    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )
    await screen.findByRole('button', { name: /文本网关 \/ text-only/ })
    const editor = screen.getByLabelText('任务描述')
    editor.textContent = '分析这张图'
    fireEvent.input(editor)
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'draft.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('添加图片'), image)
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByTestId('e2e/tasks/detail/page#page')).toBeVisible()
    expect(uploadImage).toHaveBeenCalledWith(image)
    expect(submitGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goal: '分析这张图', imageAssetIds: ['staged-vision'] })
    )
  })

  it('switches between split, expanded, and collapsed browser layouts', async () => {
    const user = userEvent.setup()
    renderApp('task')

    await user.click(await screen.findByLabelText('放大浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'browser-expanded'
    )
    await user.click(screen.getByLabelText('缩小浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
    await user.click(screen.getByLabelText('折叠浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'browser-collapsed'
    )
    await user.click(screen.getByLabelText('展开浏览器'))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', 'split')
  })

  it('hides and restores the sidebar on home without losing the draft', async () => {
    const user = userEvent.setup()
    renderApp()

    const editor = screen.getByLabelText('任务描述')
    editor.textContent = 'draft text'
    fireEvent.input(editor)
    await user.click(screen.getByRole('button', { name: '折叠侧栏' }))

    expect(screen.queryByTestId('e2e/shared/sidebar/root#nav')).not.toBeInTheDocument()
    expect(screen.getByLabelText('任务描述')).toHaveTextContent('draft text')
    await user.click(screen.getByRole('button', { name: '展开侧栏' }))

    expect(screen.getByTestId('e2e/shared/sidebar/root#nav')).toBeVisible()
    expect(screen.getByLabelText('任务描述')).toHaveTextContent('draft text')
  })

  it('restores the sidebar from the browser-only task view without changing layout', async () => {
    const user = userEvent.setup()
    renderApp('task')
    await screen.findByTestId('e2e/tasks/detail/page#page')

    await user.click(screen.getByRole('button', { name: '折叠侧栏' }))
    expect(screen.queryByTestId('e2e/shared/sidebar/root#nav')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '放大浏览器' }))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'browser-expanded'
    )
    await user.click(screen.getByRole('button', { name: '展开侧栏' }))

    expect(screen.getByTestId('e2e/shared/sidebar/root#nav')).toBeVisible()
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'browser-expanded'
    )
  })

  it('reopens the current mock task from Recent Tasks after returning home', async () => {
    const user = userEvent.setup()
    renderApp('task')

    await user.click(await screen.findByText('新任务'))
    expect(screen.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: /预订周末去杭州的酒店/ }))

    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
  })

  it('opens different recent tasks through the shared task page', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: '整理产品研究资料' }))
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toBeVisible()
    expect(screen.getAllByText('整理产品研究资料')).toHaveLength(2)
    expect(screen.queryByText('归纳关键洞察')).not.toBeInTheDocument()
    expect(screen.getByText('产品研究资料库')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '比较三款显示器' }))
    expect(screen.getAllByText('比较三款显示器')).toHaveLength(2)
    expect(screen.queryByText('核对接口规格')).not.toBeInTheDocument()
    expect(screen.getByText('显示器参数比较')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '整理产品研究资料' })).not.toBeInTheDocument()
  })

  it('keeps inert navigation on the current page', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: 'Skills' }))
    await user.click(screen.getByRole('button', { name: 'MCP' }))
    expect(screen.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
  })

  it('opens model connection settings and returns to the application', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByTestId('e2e/settings/model-connections/page#page')).toBeVisible()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '返回应用' }))
    expect(screen.getByTestId('e2e/shared/sidebar/root#nav')).toHaveAttribute('data-width', '248')
    expect(screen.getByText('我们应该在 Action-Driver 中做些什么？')).toBeVisible()
  })

  it('can start directly on the settings route', () => {
    renderApp('settings')
    expect(screen.getByRole('heading', { name: '模型连接' })).toBeVisible()
  })

  it('navigates across the single settings sidebar without duplicating the shell', async () => {
    const user = userEvent.setup()
    renderApp('settings')
    expect(screen.queryByRole('button', { name: '日志' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '主提示词' }))
    expect(await screen.findByTestId('e2e/settings/main-prompt/page#page')).toBeVisible()
    expect(screen.getAllByRole('navigation', { name: '设置导航' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Skills' }))
    expect(await screen.findByTestId('e2e/settings/skills/page#page')).toBeVisible()

    await user.click(screen.getByTestId('e2e/settings/sidebar/computer-use#button'))
    expect(await screen.findByTestId('e2e/settings/computer-use/page#page')).toBeVisible()
    // The entry stays in the sidebar once its own page is open, like every other entry.
    expect(screen.getByTestId('e2e/settings/sidebar/computer-use#button'))
      .toHaveClass('is-active')

    await user.click(screen.getByRole('button', { name: '模型连接' }))
    expect(await screen.findByTestId('e2e/settings/model-connections/page#page')).toBeVisible()
  })

  it('loads persisted models and tasks, then submits the exact selected model reference', async () => {
    const user = userEvent.setup()
    const services = createRendererServices({ mode: 'mock' })
    const completedTask = {
      id: 'real-task',
      sessionId: 'real-session',
      title: '真实模型回答',
      status: 'succeeded' as const,
      model: { connectionId: 'real-gateway', modelId: 'real-model' },
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
      seed: [
        {
          id: 'real-gateway',
          name: '真实网关',
          protocol: 'openai-compatible',
          baseUrl: 'https://real.example/v1',
          apiKeyHint: '••••real',
          expanded: true,
          models: [
            {
              id: 'real-model',
              name: 'real-model',
              enabled: true,
              testState: 'success',
              capabilities: { text: { state: 'success', source: 'probe' } }
            }
          ]
        }
      ]
    })
    services.taskCatalog = {
      listRecentTasks: async () => [
        { id: 'persisted-task', title: '持久化任务', state: 'default' }
      ],
      getTask: async () => null
    }
    services.agentCommandService = {
      submitGoal,
      interrupt: async () => undefined,
      continueTask: async () => undefined,
      provideInput: async () => undefined,
      decideAppApproval: async () => undefined
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
    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'agent-only'
    )

    const continuationEditor = screen.getByLabelText('任务描述')
    continuationEditor.textContent = '继续解释'
    fireEvent.input(continuationEditor)
    await user.click(screen.getByLabelText('发送'))
    expect(submitGoal).toHaveBeenLastCalledWith({
      goal: '继续解释',
      sessionId: 'real-session'
    })
  })

  it('shows retryable errors without falling back to production mock labels', async () => {
    const user = userEvent.setup()
    const services = createRendererServices({ mode: 'mock' })
    let rejectModels = true
    let rejectTasks = true
    services.modelConnectionsService = Object.assign(services.modelConnectionsService, {
      list: async () => {
        if (rejectModels) throw new Error('model query failed')
        return [
          {
            id: 'retry-gateway',
            name: '重试网关',
            protocol: 'openai-compatible',
            baseUrl: 'https://retry.example/v1',
            apiKeyHint: '••••retry',
            expanded: true,
            models: [
              {
                id: 'retry-model',
                name: 'retry-model',
                enabled: true,
                testState: 'success',
                capabilities: { text: { state: 'success', source: 'probe' } }
              }
            ]
          }
        ]
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
    const services = createRendererServices({ mode: 'mock' })
    const source = new MockModelConnectionsService({
      delayMs: 0,
      seed: [
        {
          id: 'mutable-gateway',
          name: '可变网关',
          protocol: 'openai-compatible',
          baseUrl: 'https://mutable.example/v1',
          apiKeyHint: '••••mutable',
          expanded: true,
          models: [
            {
              id: 'mutable-model',
              name: 'mutable-model',
              enabled: true,
              testState: 'success',
              capabilities: { text: { state: 'success', source: 'probe' } }
            }
          ]
        }
      ]
    })
    services.modelConnectionsService = source

    render(
      <AppServicesProvider services={services}>
        <App />
      </AppServicesProvider>
    )

    expect(await screen.findByRole('button', { name: /可变网关 \/ mutable-model/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('switch', { name: '启用mutable-model' }))
    await user.click(screen.getByRole('button', { name: '返回应用' }))

    expect(await screen.findByRole('button', { name: '暂无可用模型' })).toBeVisible()
    expect(screen.getByLabelText('发送')).toBeDisabled()
  })
})
