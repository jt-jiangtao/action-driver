import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { TaskPage } from './TaskPage'
import { mockTaskFixture } from '../services/mock-task-fixture'
import { defaultModelSelection } from '../models/model-selection'

describe('ActionDriver pages', () => {
  it('renders the Figma home copy and 720px composer contract', () => {
    render(
      <HomePage
        modelSelection={defaultModelSelection}
        onSelectModel={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
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
        modelSelection={defaultModelSelection}
        onSelectModel={vi.fn()}
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

  it('closes the model menu when the task layout changes without resetting the task', async () => {
    const user = userEvent.setup()
    const props = {
      task: mockTaskFixture,
      modelSelection: defaultModelSelection,
      onSelectModel: vi.fn(),
      onModeChange: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onTakeOver: vi.fn(),
      onInterrupt: vi.fn()
    }
    const { rerender } = render(<TaskPage {...props} mode="split" />)

    await user.click(screen.getByRole('button', { name: /当前模型/ }))
    expect(screen.getByRole('listbox', { name: '选择模型' })).toBeVisible()

    rerender(<TaskPage {...props} mode="browser-collapsed" />)
    expect(screen.queryByRole('listbox', { name: '选择模型' })).not.toBeInTheDocument()
    expect(screen.getByText(mockTaskFixture.title)).toBeVisible()
  })

  it('preserves the Slate draft while the browser is temporarily expanded', async () => {
    const user = userEvent.setup()
    const props = {
      task: mockTaskFixture,
      modelSelection: defaultModelSelection,
      onSelectModel: vi.fn(),
      onModeChange: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onTakeOver: vi.fn(),
      onInterrupt: vi.fn()
    }
    const { rerender } = render(<TaskPage {...props} mode="split" />)
    await user.type(screen.getByLabelText('任务描述'), 'draft')
    const draftBeforeLayoutChange = screen
      .getByLabelText('任务描述')
      .textContent?.replace(/[\s\uFEFF]/g, '')
    expect(draftBeforeLayoutChange).toBeTruthy()

    rerender(<TaskPage {...props} mode="browser-expanded" />)
    rerender(<TaskPage {...props} mode="split" />)

    expect(
      screen.getByLabelText('任务描述').textContent?.replace(/[\s\uFEFF]/g, '')
    ).toBe(draftBeforeLayoutChange)
  })
})
