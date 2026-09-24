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

  it('keeps one cursor-ordered process without a live approval control', () => {
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
            },
            {
              callId: 'call-2',
              toolId: 'web.search@1',
              modelName: 'web_search',
              summary: '搜索 “ActionDriver”',
              argumentsHash: '',
              status: 'completed',
              durationMs: 42,
              resultSummary: 'ActionDriver Documentation'
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
      />
    )
    expect(screen.queryByTestId('e2e/tasks/detail/tool-activity/running#section')).toBeNull()
    expect(screen.queryByTestId('e2e/tasks/detail/tool-activity/completed#section')).toBeNull()
    const timeline = screen.getByRole('region', { name: '任务过程' })
    expect(timeline).toHaveTextContent('已处理')
    expect(timeline).toHaveTextContent('rg TODO README.md')
    expect(timeline).toHaveTextContent('搜索 “ActionDriver”')
    expect(timeline.textContent!.indexOf('已处理')).toBeLessThan(
      timeline.textContent!.indexOf('rg TODO')
    )
    expect(screen.queryByRole('button', { name: '允许一次' })).toBeNull()
    expect(container.querySelector('.conversation-scroll .tool-activity-list')).toBeNull()
    expect(container.querySelector('.tool-approval-bar')).toBeNull()
    expect(container.querySelector('.agent-composer')).not.toBeNull()
  })

  it('shows the final answer only after the completed duration archive', () => {
    const { container } = render(
      <TaskPage
        mode="split"
        task={{ ...mockTaskFixture, status: 'succeeded', browser: null, activityDurationMs: 2800 }}
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
    const archive = screen.getByText('用时 2.8 秒')
    const answer = screen.getByText(/我会在内嵌浏览器中查找/)
    expect(archive.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.agent-message')).toHaveLength(1)
  })

  it('places each restored turn duration and archive before that turn answer', () => {
    const { container } = render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'succeeded',
          browser: null,
          messages: [
            { id: 'first-user', role: 'user', content: '测试所有工具' },
            { id: 'first-answer', role: 'agent', content: '第一轮结果' },
            { id: 'second-user', role: 'user', content: '111' },
            { id: 'second-answer', role: 'agent', content: '第二轮结果' }
          ],
          priorActivityTurns: [{
            taskId: 'first-task', userMessageId: 'first-user', durationMs: 5_000,
            activities: [{
              activityId: 'first-group', title: '测试所有工具', titleRevision: 1,
              status: 'completed', items: [{ id: 'tool:first', kind: 'tool', callId: 'first' }]
            }],
            activityTimeline: [{ id: 'activity:first-group', kind: 'activity', activityId: 'first-group' }],
            tools: [{
              callId: 'first', toolId: 'web.search@1', modelName: 'web_search',
              summary: '搜索网页', argumentsHash: '', status: 'completed'
            }]
          }],
          activityDurationMs: 2_000,
          activities: [], activityTimeline: [], tools: []
        }}
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
    const text = container.querySelector('.conversation-stream')!.textContent!
    expect(text).toMatch(/测试所有工具.*用时 5 秒.*第一轮结果.*111.*用时 2 秒.*第二轮结果/s)
    expect(screen.getByText('用时 5 秒').closest('details')).not.toBeNull()
  })

  it('shows streaming assistant text outside the activity group while running', () => {
    render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'running',
          browser: null,
          messages: [
            { id: 'current-user', role: 'user', content: '测试工具' },
            { id: 'streaming-agent', role: 'agent', content: '好的，我来测试' }
          ],
          activityTimeline: [
            { id: 'text:streaming', kind: 'text', content: '好的，我来测试', phase: 'process' }
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
      />
    )
    const process = screen.getByRole('region', { name: '任务过程' })
    expect(process).toHaveTextContent('好的，我来测试')
    expect(screen.getAllByText('好的，我来测试')).toHaveLength(1)
  })

  it('keeps only the final text visible after folding earlier process text', () => {
    render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'succeeded',
          browser: null,
          messages: [
            { id: 'current-user', role: 'user', content: '测试工具' },
            { id: 'final-agent', role: 'agent', content: '最终回答' }
          ],
          activityTimeline: [
            { id: 'text:process', kind: 'text', content: '过程说明', phase: 'process' },
            { id: 'text:final', kind: 'text', content: '最终回答', phase: 'final' }
          ],
          activities: [],
          tools: []
        }}
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
    expect(screen.getByText('最终回答')).toBeVisible()
    expect(screen.getByText('过程说明')).not.toBeVisible()
    expect(screen.getAllByText('最终回答')).toHaveLength(1)
  })

  it('preserves previous conversation turns and does not show failed process text as a conclusion', () => {
    render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'failed',
          browser: null,
          messages: [
            { id: 'old-user', role: 'user', content: '之前的问题' },
            { id: 'old-agent', role: 'agent', content: '之前的回答' },
            { id: 'new-user', role: 'user', content: '当前的问题' },
            { id: 'new-agent', role: 'agent', content: '未完成的过程正文' }
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
      />
    )
    const previous = screen.getByText('之前的回答')
    const current = screen.getByText('当前的问题')
    expect(
      previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText('未完成的过程正文')).toBeNull()
  })

  it('keeps legacy waiting approval records read-only after a task has been cancelled', () => {
    render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'paused',
          browser: null,
          tools: [
            {
              callId: 'pending',
              toolId: 'sandbox.shell.run',
              modelName: 'shell',
              summary: '运行命令',
              argumentsHash: 'hash',
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
      />
    )
    expect(screen.queryByTestId('e2e/tasks/detail/activity/approve#button')).toBeNull()
  })
})
