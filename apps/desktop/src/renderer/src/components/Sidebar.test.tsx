import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  it('renders the Codex-inspired navigation without a user footer', () => {
    render(<Sidebar active="new" onNewTask={vi.fn()} />)

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-width', '248')
    expect(screen.getByText('ActionDriver')).toBeVisible()
    expect(screen.getByText('新任务')).toBeVisible()
    expect(screen.getByText('Skills')).toBeVisible()
    expect(screen.getByText('MCP')).toBeVisible()
    expect(screen.getByText('最近任务')).toBeVisible()
    expect(screen.getByLabelText('加载中')).toBeVisible()
    expect(screen.queryByText('jiang tao')).not.toBeInTheDocument()
  })
})
