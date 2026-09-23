import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TaskProjection } from '@actiondriver/contracts'
import { ActivityTimeline } from './ActivityTimeline'

const task = (status: TaskProjection['status']): TaskProjection => ({
  id: 'task-1',
  sessionId: 'session-1',
  title: '任务',
  status,
  model: { connectionId: 'connection-1', modelId: 'model-1' },
  messages: [],
  steps: [],
  browser: null,
  activityDurationMs: 2_800,
  activityTimeline: [{ id: 'activity:research', kind: 'activity', activityId: 'research' }],
  activities: [
    {
      activityId: 'research',
      title: '调研实现',
      titleRevision: 1,
      status: status === 'running' ? 'running' : 'completed',
      items: [{ id: 'tool:read', kind: 'tool', callId: 'read' }]
    }
  ],
  tools: [
    {
      callId: 'read',
      toolId: 'sandbox.fs.read',
      modelName: 'sandbox_fs_read',
      summary: '读取 README',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed',
      rawInput: '{"path":"README.md"}',
      rawOutput: '内容',
      rawOutputTruncated: false
    }
  ]
})

describe('ActivityTimeline', () => {
  it('renders process text and tools in cursor order while excluding a classified final answer', () => {
    const mixed = task('running')
    mixed.activities![0]!.items = [
      { id: 'text:a', kind: 'text', content: '正文 A', phase: 'process' },
      { id: 'tool:read', kind: 'tool', callId: 'read' },
      { id: 'text:b', kind: 'text', content: '最终结论', phase: 'final' }
    ]
    render(<ActivityTimeline task={mixed} />)
    const process = screen.getByRole('region', { name: '任务过程' })
    expect(process.textContent?.indexOf('正文 A')).toBeLessThan(
      process.textContent!.indexOf('读取 README')
    )
    expect(process).not.toHaveTextContent('最终结论')
  })

  it('keeps a live elapsed header above the activity and advances it while running', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-23T00:00:03.000Z'))
      const running = { ...task('running'), activityStartedAt: '2026-09-23T00:00:00.000Z' }
      render(<ActivityTimeline task={running} />)

      const header = screen.getByText('已处理 3 秒')
      expect(
        header.compareDocumentPosition(screen.getByText('调研实现')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      act(() => vi.advanceTimersByTime(1_000))
      expect(screen.getByText('已处理 4 秒')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a tool action row and expands its raw input and output directly', () => {
    render(<ActivityTimeline task={task('running')} />)
    expect(screen.queryByText('⌘')).not.toBeInTheDocument()
    expect(screen.queryByText('输入与输出')).not.toBeInTheDocument()
    screen.getByText('读取 README').click()
    expect(screen.getByText('{"path":"README.md"}')).toBeVisible()
    expect(screen.getByText('内容')).toBeVisible()
  })

  it('shows a thinking tail only while no tool is active', () => {
    render(<ActivityTimeline task={task('running')} />)
    expect(screen.getByText('正在思考')).toBeVisible()
  })

  it('archives completed process closed under an elapsed-time summary', () => {
    render(<ActivityTimeline task={task('succeeded')} />)
    const archive = screen.getByText('用时 2.8 秒').closest('details')
    expect(archive).not.toHaveAttribute('open')
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  it('renders a standalone tool from a legacy or snapshot task in the same timeline', () => {
    const standalone = task('succeeded')
    standalone.activities = []
    standalone.activityTimeline = []
    standalone.tools = [
      {
        callId: 'list',
        toolId: 'sandbox.fs.list',
        modelName: 'sandbox_fs_list',
        summary: '访问文件 /',
        argumentsHash: '',
        activityId: null,
        status: 'completed',
        durationMs: 8,
        resultSummary: '已完成'
      }
    ]
    render(<ActivityTimeline task={standalone} />)
    screen.getByText('用时 2.8 秒').click()
    expect(screen.getByText('访问文件 /')).toBeVisible()
    expect(screen.queryByText('运行结束')).toBeNull()
  })
})
