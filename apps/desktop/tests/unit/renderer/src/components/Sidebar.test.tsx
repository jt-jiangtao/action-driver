import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../../../../src/renderer/src/components/Sidebar'

describe('Sidebar', () => {
  it('renders the Codex-inspired navigation without a user footer', () => {
    render(
      <Sidebar
        onCollapse={vi.fn()}
        active="new"
        activeTaskId={null}
        onNewTask={vi.fn()}
        onOpenSettings={vi.fn()}
        recentTasks={[
          { id: 'hotel-task', title: '预订周末去杭州的酒店', state: 'loading' },
          { id: 'research-task', title: '整理产品研究资料', state: 'default' }
        ]}
      />
    )

    expect(screen.getByTestId('e2e/shared/sidebar/root#nav')).toHaveAttribute('data-width', '248')
    expect(screen.getByText('Action-Driver')).toBeVisible()
    expect(screen.getByText('新任务')).toBeVisible()
    expect(screen.getByText('Skills')).toBeVisible()
    expect(screen.getByText('MCP')).toBeVisible()
    expect(screen.getByText('最近任务')).toBeVisible()
    expect(screen.getByRole('button', { name: '设置' })).toBeVisible()
    expect(screen.getByLabelText('加载中')).toBeVisible()
    expect(screen.queryByText('jiang tao')).not.toBeInTheDocument()
  })

  it('opens any recent task by its stable id and marks only the current task active', async () => {
    const user = userEvent.setup()
    const onOpenTask = vi.fn()
    render(
      <Sidebar
        onCollapse={vi.fn()}
        active="task"
        activeTaskId="research-task"
        onNewTask={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenTask={onOpenTask}
        recentTasks={[
          { id: 'hotel-task', title: '预订周末去杭州的酒店', state: 'loading' },
          { id: 'research-task', title: '整理产品研究资料', state: 'default' }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: '整理产品研究资料' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('button', { name: /预订周末去杭州的酒店/ })).not.toHaveAttribute(
      'aria-current'
    )
    await user.click(screen.getByRole('button', { name: '整理产品研究资料' }))
    expect(onOpenTask).toHaveBeenCalledWith('research-task')
  })
})
