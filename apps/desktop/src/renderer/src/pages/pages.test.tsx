import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { TaskPage } from './TaskPage'
import { mockTaskFixture } from '../services/mock-task-fixture'
import { mockModelSelection } from '../testing/model-selection-fixture'

describe('ActionDriver pages', () => {
  it('renders the Figma home copy and 720px composer contract', () => {
    render(
      <HomePage modelSelection={mockModelSelection} onSelectModel={vi.fn()} onSubmit={vi.fn()} />
    )
    expect(screen.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    expect(screen.getByTestId('e2e/home/main/composer#section')).toHaveAttribute(
      'data-width',
      '720'
    )
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
        modelSelection={mockModelSelection}
        onSelectModel={vi.fn()}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
        onInterrupt={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute('data-mode', mode)
    expect(screen.getByTestId('e2e/tasks/detail/agent#section')).toHaveAttribute(
      'data-width',
      agentWidth
    )
    expect(screen.getByTestId('e2e/tasks/detail/browser#section')).toHaveAttribute(
      'data-width',
      browserWidth
    )
  })

  it('closes the model menu when the task layout changes without resetting the task', async () => {
    const user = userEvent.setup()
    const props = {
      task: mockTaskFixture,
      modelSelection: mockModelSelection,
      onSelectModel: vi.fn(),
      onModeChange: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onTakeOver: vi.fn(),
      onInterrupt: vi.fn(),
      onSubmit: vi.fn()
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
      modelSelection: mockModelSelection,
      onSelectModel: vi.fn(),
      onModeChange: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onTakeOver: vi.fn(),
      onInterrupt: vi.fn(),
      onSubmit: vi.fn()
    }
    const { rerender } = render(<TaskPage {...props} mode="split" />)
    await user.type(screen.getByLabelText('任务描述'), 'draft')
    const draftBeforeLayoutChange = screen
      .getByLabelText('任务描述')
      .textContent?.replace(/[\s\uFEFF]/g, '')
    expect(draftBeforeLayoutChange).toBeTruthy()

    rerender(<TaskPage {...props} mode="browser-expanded" />)
    rerender(<TaskPage {...props} mode="split" />)

    expect(screen.getByLabelText('任务描述').textContent?.replace(/[\s\uFEFF]/g, '')).toBe(
      draftBeforeLayoutChange
    )
  })

  it('uses the full-width Agent layout when a persisted task has no browser session', () => {
    render(
      <TaskPage
        mode="split"
        task={{ ...mockTaskFixture, browser: null }}
        modelSelection={mockModelSelection}
        onSelectModel={vi.fn()}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
        onInterrupt={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByTestId('e2e/tasks/detail/page#page')).toHaveAttribute(
      'data-mode',
      'agent-only'
    )
    expect(screen.getByTestId('e2e/tasks/detail/agent#section')).toHaveAttribute(
      'data-width',
      '1192'
    )
    expect(screen.queryByTestId('e2e/tasks/detail/browser#section')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开浏览器' })).not.toBeInTheDocument()
    expect(screen.queryByText('执行进度')).not.toBeInTheDocument()
  })

  it('keeps terminal task input editable and submits a continuation for the same session', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TaskPage
        mode="split"
        task={{ ...mockTaskFixture, status: 'succeeded', browser: null }}
        modelSelection={mockModelSelection}
        onSelectModel={vi.fn()}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
        onInterrupt={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    expect(screen.getByLabelText('任务描述')).toHaveAttribute('contenteditable', 'true')
    const editor = screen.getByLabelText('任务描述')
    editor.textContent = '继续解释'
    fireEvent.input(editor)
    await user.click(screen.getByLabelText('发送'))
    expect(onSubmit).toHaveBeenCalledWith('继续解释')
    expect(screen.queryByText('执行进度')).not.toBeInTheDocument()
  })

  it('keeps the message viewport before the bottom composer in the document layout', () => {
    const { container } = render(
      <TaskPage
        mode="split"
        task={{ ...mockTaskFixture, browser: null }}
        modelSelection={mockModelSelection}
        onSelectModel={vi.fn()}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
        onInterrupt={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    const body = container.querySelector('.conversation-body')!
    expect(body.children[0]).toHaveClass('conversation-scroll')
    expect(body.children[1]).toHaveClass('agent-composer')
    expect(body.querySelector('.conversation-scroll .agent-composer')).toBeNull()
    expect(screen.queryByText('执行进度')).not.toBeInTheDocument()
  })

  it('places a waiting tool approval between the scrollable conversation and anchored composer', () => {
    const { container } = render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          browser: null,
          tools: [
            {
              callId: 'call-1',
              toolId: 'sandbox.shell.run',
              modelName: 'sandbox_shell_run',
              summary: 'rg TODO README.md',
              argumentsHash: 'sha256:abc',
              status: 'waiting_approval'
            }
          ]
        }}
        modelSelection={mockModelSelection}
        onSelectModel={vi.fn()}
        onModeChange={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onTakeOver={vi.fn()}
        onInterrupt={vi.fn()}
        onSubmit={vi.fn()}
        onApproveTool={vi.fn(async () => undefined)}
        onRejectTool={vi.fn(async () => undefined)}
      />
    )
    const body = container.querySelector('.conversation-body')!
    expect([...body.children].map((child) => child.className)).toEqual([
      'conversation-scroll',
      'tool-approval-list',
      'agent-composer'
    ])
  })
})
