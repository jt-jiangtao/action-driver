import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPanel } from './BrowserPanel'
import { mockTaskFixture } from '../services/mock-task-fixture'

describe('BrowserPanel', () => {
  it('renders the static raster, target highlight, and running controls', () => {
    render(
      <BrowserPanel
        mode="split"
        projection={mockTaskFixture.browser!}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
      />
    )

    expect(screen.getByAltText('杭州酒店搜索结果')).toBeVisible()
    expect(screen.getByText('选择入住日期')).toBeVisible()
    expect(screen.getByText('Browser Skill · 运行中')).toBeVisible()
    expect(screen.getByText('暂停')).toBeVisible()
    expect(screen.getByText('人工接管')).toBeVisible()
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
