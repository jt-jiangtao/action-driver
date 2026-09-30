import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPanel } from '../../../../../src/renderer/src/components/BrowserPanel'
import { BrowserSizeToggle } from '../../../../../src/renderer/src/components/browser/BrowserSizeToggle'
import { BrowserSkillControls } from '../../../../../src/renderer/src/components/browser/BrowserSkillControls'
import { mockTaskFixture } from '../../../../../src/renderer/src/services/task-catalog/mock-task-fixture'

describe('BrowserPanel', () => {
  it('exposes maximize and restore through the size toggle component', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    const { rerender } = render(<BrowserSizeToggle expanded={false} onModeChange={onModeChange} />)

    await user.click(screen.getByRole('button', { name: '放大浏览器' }))
    expect(onModeChange).toHaveBeenCalledWith('browser-expanded')

    rerender(<BrowserSizeToggle expanded onModeChange={onModeChange} />)
    await user.click(screen.getByRole('button', { name: '缩小浏览器' }))
    expect(onModeChange).toHaveBeenCalledWith('split')
  })

  it('locks the extracted floating controls while a command is pending', async () => {
    const user = userEvent.setup()
    let finish: (() => void) | undefined
    const onPause = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(
      <BrowserSkillControls
        status="running"
        onPause={onPause}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )

    await user.dblClick(screen.getByRole('button', { name: '暂停' }))
    expect(onPause).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Browser Skill 控制')).toHaveAttribute('aria-busy', 'true')
    finish?.()
  })
  it('should show an empty browser with controls when no live session exists', () => {
    const { rerender } = render(
      <BrowserPanel
        mode="split"
        projection={mockTaskFixture.browser!}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )

    expect(screen.getByText('开始浏览')).toBeVisible()
    expect(screen.queryByAltText('杭州酒店搜索结果')).not.toBeInTheDocument()
    expect(screen.queryByText('选择入住日期')).not.toBeInTheDocument()
    expect(screen.getByText('Browser Skill · 运行中')).toBeVisible()
    expect(screen.getByText('暂停')).toBeVisible()
    expect(screen.getByText('人工接管')).toBeVisible()

    rerender(<BrowserPanel mode="browser-expanded" projection={mockTaskFixture.browser!}
      onModeChange={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onTakeOver={vi.fn()} />)
    expect(screen.getByText('开始浏览')).toBeVisible()
    expect(screen.queryByAltText('杭州酒店搜索结果')).not.toBeInTheDocument()
  })

  it('uses the managed page and sends address-bar navigation to its active tab', async () => {
    const user = userEvent.setup()
    const command = vi.fn(async () => null)
    Object.defineProperty(window, 'productDesktop', { configurable: true,
      value: { browserSession: { command, setViewport: vi.fn(async () => undefined) } } })
    render(<BrowserPanel taskId="task-1" mode="split"
      projection={{ ...mockTaskFixture.browser!, title: 'Example', url: 'https://example.test/',
        sessionId: 'session-1', surface: 'embedded', activeTabId: 'tab-1', tabs: [
          { id: 'tab-1', title: 'Example', url: 'https://example.test/', loading: false,
            canGoBack: true, canGoForward: false }
        ] }}
      onModeChange={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} onTakeOver={vi.fn()} />)
    expect(screen.queryByText('开始浏览')).not.toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: '地址' }))
    await user.type(screen.getByRole('textbox', { name: '地址' }), 'https://wikipedia.org/{Enter}')
    expect(command).toHaveBeenCalledWith({ action: 'execute', taskId: 'task-1',
      sessionId: 'session-1', tabId: 'tab-1', command: {
        type: 'navigate', url: 'https://wikipedia.org/'
      } })
    Object.defineProperty(window, 'productDesktop', { configurable: true, value: undefined })
  })

  it('switches to continue Agent after takeover', async () => {
    const user = userEvent.setup()
    const onResume = vi.fn()
    render(
      <BrowserPanel
        mode="split"
        projection={{ ...mockTaskFixture.browser!, status: 'taken-over' }}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={onResume}
        onTakeOver={vi.fn()}
      />
    )

    expect(screen.getByText('Browser Skill · 人工接管中')).toBeVisible()
    expect(screen.getByRole('button', { name: '人工接管' })).toBeDisabled()
    await user.click(screen.getByText('继续 Agent'))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it.each([
    ['queued', 'Browser Skill · 等待开始'],
    ['waiting-user', 'Browser Skill · 等待用户'],
    ['succeeded', 'Browser Skill · 已完成'],
    ['failed', 'Browser Skill · 已中断']
  ] as const)('renders %s without presenting invalid running controls', (status, label) => {
    render(
      <BrowserPanel
        mode="split"
        projection={{ ...mockTaskFixture.browser!, status }}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )

    expect(screen.getByText(label)).toBeVisible()
    expect(screen.queryByText('暂停')).not.toBeInTheDocument()
    expect(screen.queryByText('人工接管')).not.toBeInTheDocument()
  })

  it('renders the paused controls and one size action for each layout state', () => {
    const { rerender } = render(
      <BrowserPanel
        mode="split"
        projection={{ ...mockTaskFixture.browser!, status: 'paused' }}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )

    expect(screen.getByText('Browser Skill · 已暂停')).toBeVisible()
    expect(screen.getByText('继续 Agent')).toBeVisible()
    expect(screen.getAllByLabelText('放大浏览器')).toHaveLength(1)
    expect(screen.getAllByLabelText('折叠浏览器')).toHaveLength(1)

    rerender(
      <BrowserPanel
        mode="browser-expanded"
        projection={mockTaskFixture.browser!}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )
    expect(screen.getAllByLabelText('缩小浏览器')).toHaveLength(1)
    expect(screen.queryByLabelText('放大浏览器')).not.toBeInTheDocument()
  })

  it('prevents duplicate skill commands while a transition is pending', async () => {
    const user = userEvent.setup()
    let finishPause: (() => void) | undefined
    const onPause = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPause = resolve
        })
    )
    render(
      <BrowserPanel
        mode="split"
        projection={mockTaskFixture.browser!}
        onModeChange={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )

    const pause = screen.getByRole('button', { name: '暂停' })
    await user.dblClick(pause)
    expect(onPause).toHaveBeenCalledOnce()
    finishPause?.()
  })
})
