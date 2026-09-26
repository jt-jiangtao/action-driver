import type { AppApprovalDecision } from '@actiondriver/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { TaskPage } from './TaskPage'
import { mockTaskFixture } from '../services/mock-task-fixture'
import { mockModelSelection } from '../testing/model-selection-fixture'

describe('ActionDriver pages', () => {
  it.each([['拒绝', 'deny'], ['仅本次', 'once'], ['本会话', 'session'], ['始终允许', 'always']])('sends %s through app approval', async (label, decision) => {
    const onAppDecision = vi.fn(async () => undefined)
    const view = renderApproval(onAppDecision)
    expect(screen.getByText('TextEdit')).toBeVisible()
    expect(screen.getByText('将允许读取和操作此应用')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(onAppDecision).toHaveBeenCalledExactlyOnceWith('approval-1', decision)
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    view.unmount()
  })

  it('hides persistent approval when policy prohibits it and permits retry after failure', async () => {
    const onAppDecision = vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue(undefined)
    const view = renderApproval(onAppDecision, false)
    expect(screen.queryByRole('button', { name: '始终允许' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '仅本次' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('连接失败')
    await userEvent.click(screen.getByRole('button', { name: '仅本次' }))
    expect(onAppDecision).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('blocks duplicate decisions while the request is pending', async () => {
    const onAppDecision = vi.fn(() => new Promise<void>(() => {}))
    const view = renderApproval(onAppDecision)
    await userEvent.click(screen.getByRole('button', { name: '仅本次' }))
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(onAppDecision).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('wires Computer Use pause, takeover, and resume to the desktop task controls', async () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onTakeOver = vi.fn()
    const computerTask = {
      ...mockTaskFixture,
      browser: null,
      status: 'running' as const,
      tools: [{
        callId: 'computer-call', toolId: 'computer.observe', modelName: 'computer_observe',
        summary: '观察当前桌面', argumentsHash: 'hash', status: 'completed' as const
      }]
    }
    const props = {
      mode: 'split' as const, modelSelection: mockModelSelection, onSelectModel: vi.fn(),
      onModeChange: vi.fn(), onPause, onResume, onTakeOver, onInterrupt: vi.fn(), onSubmit: vi.fn()
    }
    const view = render(<TaskPage {...props} task={computerTask} />)
    await userEvent.click(screen.getByTestId('e2e/tasks/detail/computer/pause#button'))
    await userEvent.click(screen.getByTestId('e2e/tasks/detail/computer/take-over#button'))
    expect(onPause).toHaveBeenCalledOnce()
    expect(onTakeOver).toHaveBeenCalledOnce()
    view.rerender(<TaskPage {...props} task={{ ...computerTask, status: 'paused' }} />)
    await userEvent.click(screen.getByTestId('e2e/tasks/detail/computer/resume#button'))
    expect(onResume).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('shows image slots before the first asset and keeps new assistant text above them', () => {
    const task = {
      ...mockTaskFixture,
      status: 'running' as const,
      browser: null,
      messages: [
        { id: 'user-gallery', role: 'user' as const, content: '生成两张' },
        { id: 'assistant-gallery', role: 'agent' as const, content: '' }
      ],
      tools: [{ callId: 'call-gallery', toolId: 'image.generate', modelName: 'image_generate', summary: '生成图片', argumentsHash: '', status: 'running' as const, imageCount: 2 }]
    }
    const props = { mode: 'split' as const, task, modelSelection: mockModelSelection,
      onSelectModel: vi.fn(), onModeChange: vi.fn(), onPause: vi.fn(), onResume: vi.fn(),
      onTakeOver: vi.fn(), onInterrupt: vi.fn(), onSubmit: vi.fn() }
    const view = render(<TaskPage {...props} />)
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(2)
    view.rerender(<TaskPage {...props} task={{ ...task, messages: [
      task.messages[0]!, { id: 'assistant-gallery', role: 'agent', content: '正在绘制' }
    ] }} />)
    expect(view.container.querySelector('.agent-message-with-images')?.firstElementChild).toHaveTextContent('正在绘制')
    expect(view.container.querySelectorAll('.image-gallery-slot')).toHaveLength(2)
  })
  it('shows completed generated images while legacy process text stays in the activity group', async () => {
    const asset = {
      assetId: 'generated-1',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'running',
          browser: null,
          messages: [
            { id: 'user-1', role: 'user', content: '画图' },
            {
              id: 'assistant-1',
              role: 'agent',
              content: '过程文字',
              parts: [
                { kind: 'text', text: '过程文字' },
                { kind: 'image', asset }
              ]
            }
          ],
          activityTimeline: [
            { id: 'text:process', kind: 'text', content: '过程文字', phase: 'process' }
          ],
          activities: []
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
    const placeholder = await screen.findByText('图片无法读取')
    expect(placeholder).toBeVisible()
    expect(placeholder.closest('.agent-message')).not.toHaveTextContent('过程文字')
  })
  it.each(['failed', 'paused'] as const)('keeps a %s image batch visible without repeating archived process text', (status) => {
    const task = {
      ...mockTaskFixture, status, browser: null,
      messages: [
        { id: 'user-image', role: 'user' as const, content: '画图' },
        { id: 'agent-image', role: 'agent' as const, content: '过程文字', parts: [
          { kind: 'text' as const, text: '过程文字' },
          { kind: 'image-batch' as const, callId: 'image-call', imageCount: 2 }
        ] }
      ],
      activityTimeline: [{ id: 'text:process', kind: 'text' as const, content: '过程文字', phase: 'process' as const }],
      tools: [{ callId: 'image-call', toolId: 'image.generate', modelName: 'image_generate',
        summary: '生成图片', argumentsHash: '', status: status === 'failed' ? 'failed' as const : 'cancelled' as const,
        imageCount: 2 }]
    }
    const view = render(<TaskPage mode="split" task={task} modelSelection={mockModelSelection}
      onSelectModel={vi.fn()} onModeChange={vi.fn()} onPause={vi.fn()} onResume={vi.fn()}
      onTakeOver={vi.fn()} onInterrupt={vi.fn()} onSubmit={vi.fn()} />)
    expect(view.container.querySelectorAll('.agent-message .image-gallery-slot')).toHaveLength(2)
    expect(view.container.querySelector('.agent-message')).not.toHaveTextContent('过程文字')
  })
  it('keeps the answer with its image and leaves the archived过程 text upstream', () => {
    const asset = {
      assetId: 'generated-answer', sessionId: 'session-1', mimeType: 'image/png' as const,
      width: 1, height: 1, byteLength: 20, source: 'generated' as const
    }
    const view = render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'succeeded',
          browser: null,
          activityDurationMs: 6_000,
          messages: [
            { id: 'user-answer', role: 'user', content: '测试所有工具' },
            {
              id: 'agent-answer',
              role: 'agent',
              content: '好的，我来测试全部完成',
              parts: [
                { kind: 'text', text: '好的，我来测试' },
                { kind: 'image-batch', callId: 'image-answer', imageCount: 1 },
                { kind: 'image', asset, generation: { callId: 'image-answer', index: 0 } },
                { kind: 'text', text: '全部完成' }
              ]
            }
          ],
          activityTimeline: [
            { id: 'text:plan:1', kind: 'text', content: '好的，我来测试', phase: 'process' },
            { id: 'text:plan:2', kind: 'text', content: '全部完成', phase: 'final' }
          ],
          tools: [
            {
              callId: 'image-answer', toolId: 'image.generate', modelName: 'image_generate',
              summary: '生成图片', argumentsHash: '', status: 'completed', imageCount: 1
            }
          ],
          activities: []
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
    const message = view.container.querySelector('.agent-message')
    expect(message).toHaveTextContent('全部完成')
    expect(message).not.toHaveTextContent('好的，我来测试')
    // The process narration and the tool group stay in the elapsed-time archive.
    expect(view.container.querySelector('.activity-archive')).toHaveTextContent('好的，我来测试')
  })
  it('keeps the legacy message empty while the activity mirror leads the answer stream', () => {
    const view = render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'running',
          browser: null,
          messages: [
            { id: 'user-live', role: 'user', content: '画图' },
            {
              id: 'agent-live',
              role: 'agent',
              content: '过程文字',
              parts: [
                { kind: 'text', text: '过程文字' },
                { kind: 'image-batch', callId: 'image-live', imageCount: 1 }
              ]
            }
          ],
          // The activity channel has already mirrored one more delta than the
          // answer channel, which used to make the message text flash on.
          activityTimeline: [
            { id: 'text:plan:1', kind: 'text', content: '过程文字已', phase: 'pending' }
          ],
          tools: [
            {
              callId: 'image-live', toolId: 'image.generate', modelName: 'image_generate',
              summary: '生成图片', argumentsHash: '', status: 'running', imageCount: 1
            }
          ],
          activities: []
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
    expect(view.container.querySelector('.agent-message')).not.toHaveTextContent('过程文字')
    expect(view.container.querySelector('.activity-timeline')).toHaveTextContent('过程文字已')
  })
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
    const archive = screen.getByText('用时 3 秒')
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
          priorActivityTurns: [
            {
              taskId: 'first-task',
              userMessageId: 'first-user',
              durationMs: 5_000,
              activities: [
                {
                  activityId: 'first-group',
                  title: '测试所有工具',
                  titleRevision: 1,
                  status: 'completed',
                  items: [{ id: 'tool:first', kind: 'tool', callId: 'first' }]
                }
              ],
              activityTimeline: [
                { id: 'activity:first-group', kind: 'activity', activityId: 'first-group' }
              ],
              tools: [
                {
                  callId: 'first',
                  toolId: 'web.search@1',
                  modelName: 'web_search',
                  summary: '搜索网页',
                  argumentsHash: '',
                  status: 'completed'
                }
              ]
            }
          ],
          activityDurationMs: 2_000,
          activities: [],
          activityTimeline: [],
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
    const text = container.querySelector('.conversation-stream')!.textContent!
    expect(text).toMatch(/测试所有工具.*用时 5 秒.*第一轮结果.*111.*用时 2 秒.*第二轮结果/s)
    expect(screen.getByText('用时 5 秒').closest('details')).not.toBeNull()
  })

  it('shows legacy streaming assistant text outside the activity group while running', () => {
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

  it('keeps prose, tool group, image and answer in the order the model produced them', () => {
    const asset = {
      assetId: 'ordered-image',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    const view = render(
      <TaskPage
        mode="split"
        task={{
          ...mockTaskFixture,
          status: 'succeeded',
          browser: null,
          activityDurationMs: 5_000,
          messages: [
            { id: 'user-order', role: 'user', content: '测试所有工具' },
            {
              id: 'agent-order',
              role: 'agent',
              content: '先说明全部完成',
              parts: [
                { kind: 'text', text: '先说明' },
                { kind: 'activity', activityId: 'activity:tools' },
                { kind: 'image-batch', callId: 'image-order', imageCount: 1 },
                { kind: 'image', asset, generation: { callId: 'image-order', index: 0 } },
                { kind: 'text', text: '全部完成' }
              ]
            }
          ],
          activityTimeline: [
            { id: 'text:plan:1', kind: 'text', content: '先说明', phase: 'process' },
            { id: 'activity:tools', kind: 'activity', activityId: 'activity:tools' },
            { id: 'text:plan:2', kind: 'text', content: '全部完成', phase: 'final' }
          ],
          activities: [
            {
              activityId: 'activity:tools',
              title: '正在测试所有工具',
              titleRevision: 1,
              status: 'completed',
              items: [{ id: 'tool:shell', kind: 'tool', callId: 'shell' }]
            }
          ],
          tools: [
            {
              callId: 'shell',
              toolId: 'sanbox.shell.run',
              modelName: 'shell_run',
              summary: '执行命令',
              title: '已执行命令',
              argumentsHash: '',
              activityId: 'activity:tools',
              status: 'completed'
            },
            {
              callId: 'image-order',
              toolId: 'image.generate',
              modelName: 'image_generate',
              summary: '生成图片',
              argumentsHash: '',
              activityId: 'activity:tools',
              status: 'completed',
              imageCount: 1
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
    const process = view.container.querySelector('.activity-timeline')!
    // The narration the model wrote before its tools stays above the group in
    // the activity area, so the two regions together read in stream order.
    expect(process).toHaveTextContent('先说明')
    const processFlow = [...process.querySelectorAll('.activity-process-text, .activity-group')].map(
      (node) => (node.classList.contains('activity-group') ? 'activity' : 'text')
    )
    expect(processFlow).toEqual(['text', 'activity'])
    const message = view.container.querySelector('.agent-message')!
    const messageFlow = [...message.children].map((child) =>
      child.querySelector('.image-gallery-slot, .image-gallery') ? 'image' : 'text'
    )
    expect(messageFlow).toEqual(['image', 'text'])
    expect(message).toHaveTextContent('全部完成')
    expect(message).not.toHaveTextContent('先说明')
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

  it('shows a provider image rejection below the failed turn instead of leaving a blank reply', () => {
    const task = {
      ...mockTaskFixture,
      status: 'failed' as const,
      browser: null,
      messages: [
        { id: 'user-image', role: 'user' as const, content: '这是什么' },
        { id: 'assistant-empty', role: 'agent' as const, content: '' }
      ],
      steps: [
        {
          id: 'step:failed',
          title: 'Agent 执行',
          detail: '400 Unexpected item type in content',
          state: 'failed' as const
        }
      ]
    }
    const props = {
      mode: 'split' as const,
      task,
      modelSelection: mockModelSelection,
      onSelectModel: vi.fn(),
      onModeChange: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onTakeOver: vi.fn(),
      onInterrupt: vi.fn(),
      onSubmit: vi.fn()
    }
    const view = render(<TaskPage {...props} />)
    expect(screen.getByRole('alert')).toHaveTextContent('400 Unexpected item type in content')
    const user = screen.getByText('这是什么')
    const failure = screen.getByRole('alert')
    expect(user.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    view.rerender(<TaskPage {...props} task={{ ...task }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('400 Unexpected item type in content')
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

  // 3.1: the card shows the real application icon when macOS can provide one.
  it('shows the real application icon on the approval card', async () => {
    const getAppIcon = vi.fn(async () => 'data:image/png;base64,QQ==')
    vi.stubGlobal('actionDriverDesktop', { computerUse: { getAppIcon } })
    renderApproval(vi.fn())
    await expect.poll(() => document.querySelector('.app-approval-icon')?.getAttribute('src'))
      .toBe('data:image/png;base64,QQ==')
    expect(getAppIcon).toHaveBeenCalledWith('/Applications/TextEdit.app')
    vi.unstubAllGlobals()
  })

  it('falls back to the placeholder when the application icon is unavailable', async () => {
    vi.stubGlobal('actionDriverDesktop', { computerUse: { getAppIcon: vi.fn(async () => null) } })
    renderApproval(vi.fn())
    await screen.findByTestId('e2e/tasks/detail/computer/app-approval-once#button')
    expect(document.querySelector('.app-approval-icon')).toBeNull()
    vi.unstubAllGlobals()
  })
})

function renderApproval(onAppDecision: (requestId: string, decision: AppApprovalDecision) => Promise<unknown>, allowPersistentApproval = true) {
  return render(<TaskPage mode="split" task={{ ...mockTaskFixture, browser: null, status: 'running',
    pendingAppApproval: [{ requestId: 'approval-1', taskId: mockTaskFixture.id, sessionId: mockTaskFixture.sessionId,
      target: { bundleId: 'com.apple.TextEdit', displayName: 'TextEdit', appPath: '/Applications/TextEdit.app', risk: 'low', warningSubtitle: '将允许读取和操作此应用' }, allowPersistentApproval }]
  }} modelSelection={mockModelSelection} onSelectModel={vi.fn()} onModeChange={vi.fn()}
    onPause={vi.fn()} onResume={vi.fn()} onTakeOver={vi.fn()} onAppDecision={onAppDecision}
    onInterrupt={vi.fn()} onSubmit={vi.fn()} />)
}
