import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { TaskPage } from './TaskPage'
import { mockTaskFixture } from '../services/mock-task-fixture'

describe('ActionDriver pages', () => {
  it('renders the Figma home copy and 720px composer contract', () => {
    render(<HomePage onSubmit={vi.fn()} />)
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    expect(screen.getByTestId('home-composer')).toHaveAttribute('data-width', '720')
  })

  it.each([
    ['split', '536', '656'],
    ['browser-expanded', '0', '1192'],
    ['browser-collapsed', '1192', '0']
  ] as const)('renders %s without panel overlap', (mode, agentWidth, browserWidth) => {
    render(
      <TaskPage
        mode={mode}
        task={mockTaskFixture}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
        onInterrupt={vi.fn()}
      />
    )

    expect(screen.getByTestId('task-page')).toHaveAttribute('data-mode', mode)
    expect(screen.getByTestId('agent-panel')).toHaveAttribute('data-width', agentWidth)
    expect(screen.getByTestId('browser-panel-slot')).toHaveAttribute('data-width', browserWidth)
  })
})
