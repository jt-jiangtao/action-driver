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
  it('shows thinking without a tool group while waiting for model output', () => {
    const waiting = task('running')
    waiting.activityTimeline = []
    waiting.activities = []
    waiting.tools = []
    const { container } = render(<ActivityTimeline task={waiting} />)
    expect(screen.getByText('正在思考')).toHaveClass('activity-active-title')
    expect(screen.queryByText('正在处理请求')).toBeNull()
    expect(document.querySelector('.activity-group')).toBeNull()
    expect(container.querySelector('.activity-timeline-items')).toBeNull()
    expect(container.querySelector('.activity-timeline')).toHaveClass('is-initial-thinking')
  })

  it('keeps process text between groups and archives it after completion', () => {
    const mixed = task('running')
    mixed.activityTimeline = [
      { id: 'text:first', kind: 'text', content: '先说明', phase: 'process' },
      { id: 'activity:research', kind: 'activity', activityId: 'research' },
      { id: 'text:second', kind: 'text', content: '再说明', phase: 'process' },
      { id: 'activity:second', kind: 'activity', activityId: 'second' },
      { id: 'text:final', kind: 'text', content: '最后回答', phase: 'pending' }
    ]
    mixed.activities!.push({
      activityId: 'second',
      title: '已执行命令',
      titleRevision: 2,
      status: 'completed',
      items: [{ id: 'tool:shell', kind: 'tool', callId: 'shell' }]
    })
    mixed.tools!.push({
      callId: 'shell',
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: '执行命令',
      title: '已执行命令',
      argumentsHash: '',
      activityId: 'second',
      status: 'completed'
    })
    const { rerender } = render(<ActivityTimeline task={mixed} />)
    const region = screen.getByRole('region', { name: '任务过程' })
    expect(region.textContent).toMatch(/先说明.*调研实现.*再说明.*已执行命令.*最后回答/s)
    expect(region.querySelectorAll('.activity-group')).toHaveLength(2)
    rerender(
      <ActivityTimeline
        task={{
          ...mixed,
          status: 'succeeded',
          activityTimeline: mixed.activityTimeline!.map((item) =>
            item.id === 'text:final' && item.kind === 'text'
              ? { ...item, phase: 'final' as const }
              : item
          )
        }}
      />
    )
    expect(screen.getByTestId('e2e/tasks/detail/activity/archive#button')).toBeVisible()
    expect(region).toHaveTextContent('先说明')
    expect(region).toHaveTextContent('再说明')
    expect(region).not.toHaveTextContent('最后回答')
  })

  it('starts both completed and running groups collapsed', () => {
    const mixed = task('running')
    mixed.activities![0]!.status = 'completed'
    mixed.activities!.push({
      activityId: 'next',
      title: '正在执行命令',
      titleRevision: 1,
      status: 'running',
      items: [{ id: 'tool:next', kind: 'tool', callId: 'next' }]
    })
    mixed.activityTimeline!.push({ id: 'activity:next', kind: 'activity', activityId: 'next' })
    mixed.tools!.push({
      callId: 'next',
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: '执行命令',
      argumentsHash: '',
      activityId: 'next',
      status: 'running'
    })
    const { container } = render(<ActivityTimeline task={mixed} />)
    const groups = container.querySelectorAll<HTMLDetailsElement>('details.activity-group')
    expect(groups).toHaveLength(2)
    expect(groups[0]?.open).toBe(false)
    expect(groups[1]?.open).toBe(false)
  })

  it('formats a completed duration over one minute like the reference header', () => {
    const completed = task('succeeded')
    completed.activityDurationMs = 7 * 60_000 + 22_000
    render(<ActivityTimeline task={completed} />)
    expect(screen.getByText('用时 7 分 22 秒')).toBeVisible()
  })

  it('keeps model body text out of the activity group and preserves tool rows', () => {
    const mixed = task('running')
    mixed.activityTimeline!.unshift({
      id: 'text:standalone',
      kind: 'text',
      content: '组外模型正文',
      phase: 'process'
    })
    mixed.activities![0]!.items = [
      { id: 'text:a', kind: 'text', content: '正文 A', phase: 'process' },
      { id: 'tool:read', kind: 'tool', callId: 'read' },
      { id: 'text:b', kind: 'text', content: '最终结论', phase: 'final' }
    ]
    render(<ActivityTimeline task={mixed} />)
    const process = screen.getByRole('region', { name: '任务过程' })
    expect(process).toHaveTextContent('读取 README')
    expect(process).toHaveTextContent('组外模型正文')
    const group = process.querySelector('.activity-group')
    expect(group).not.toHaveTextContent('组外模型正文')
    expect(group).not.toHaveTextContent('正文 A')
    expect(group).not.toHaveTextContent('最终结论')
  })

  it('renders a group without visible tool content as a static title', () => {
    const empty = task('running')
    empty.activities![0]!.items = [
      { id: 'text:only', kind: 'text', content: '不可展开的正文', phase: 'process' }
    ]
    render(<ActivityTimeline task={empty} />)
    const group = screen.getByText('调研实现').closest('.activity-group')
    expect(group).not.toBeNull()
    expect(group?.querySelector('summary')).toBeNull()
    expect(group?.querySelector('.activity-chevron')).toBeNull()
    expect(group).not.toHaveTextContent('不可展开的正文')
  })

  it('keeps a group with visible tool content expandable', () => {
    const runningTool = task('running')
    runningTool.tools![0]!.status = 'running'
    render(<ActivityTimeline task={runningTool} />)
    const group = screen.getByText('调研实现').closest('.activity-group')
    expect(group?.querySelector('summary')).not.toBeNull()
    expect(group?.querySelector('.activity-chevron')).not.toBeNull()
    expect((group as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText('调研实现')).toHaveClass('activity-active-title')
  })

  it('only animates the group and tool rows that are actually running', () => {
    const mixed = task('running')
    mixed.tools![0]!.status = 'running'
    mixed.activities![0]!.items.push({ id: 'tool:queued', kind: 'tool', callId: 'queued' })
    mixed.tools!.push({
      callId: 'queued',
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: '等待执行命令',
      argumentsHash: '',
      activityId: 'research',
      status: 'queued'
    })
    const { rerender } = render(<ActivityTimeline task={mixed} />)
    const group = screen.getByText('调研实现').closest('details') as HTMLDetailsElement
    expect(group.open).toBe(false)
    expect(screen.getByText('调研实现')).toHaveClass('activity-active-title')
    expect(screen.getByText('读取 README').closest('.activity-tool-label')).toHaveClass(
      'activity-active-title'
    )
    expect(screen.getByText('等待执行命令').closest('.activity-tool-label')).not.toHaveClass(
      'activity-active-title'
    )

    group.querySelector('summary')!.click()
    expect(group.open).toBe(true)
    rerender(<ActivityTimeline task={{ ...mixed, activities: [...mixed.activities!] }} />)
    expect(group.open).toBe(true)

    mixed.tools![0] = { ...mixed.tools![0]!, status: 'completed' }
    rerender(<ActivityTimeline task={{ ...mixed, tools: [...mixed.tools!] }} />)
    expect(group.open).toBe(true)
    expect(screen.getByText('调研实现')).not.toHaveClass('activity-active-title')
    expect(screen.getByText('读取 README').closest('.activity-tool-label')).not.toHaveClass(
      'activity-active-title'
    )
  })

  it('stops animating a group title once its latest tool reaches a terminal state', () => {
    const completedTool = task('running')
    completedTool.activities![0]!.title = '已读取文件'
    render(<ActivityTimeline task={completedTool} />)
    expect(screen.getByText('已读取文件')).not.toHaveClass('activity-active-title')
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
    screen.getByText('调研实现').closest('summary')!.click()
    expect(screen.getByText('读取 README').closest('.activity-tool')).toContainElement(
      document.querySelector('.activity-tool .lucide-book-open')
    )
    expect(screen.queryByText('⌘')).not.toBeInTheDocument()
    expect(screen.queryByText('输入与输出')).not.toBeInTheDocument()
    screen.getByText('读取 README').click()
    expect(screen.getByText('{"path":"README.md"}')).toBeVisible()
    expect(screen.getByText('内容')).toBeVisible()
  })

  it('underlines the actual file name in a file tool row without changing its summary', () => {
    const read = task('running')
    read.tools![0]!.summary = '访问文件 README.md'
    const { container } = render(<ActivityTimeline task={read} />)
    expect(container.querySelector('.activity-tool-label')).toHaveTextContent('访问文件 README.md')
    expect(container.querySelector('.activity-tool-path')).toHaveTextContent('README.md')
  })

  it('uses a wrench for a mixed tool activity and distinct book, search and terminal child icons', () => {
    const mixed = task('running')
    mixed.activities![0]!.title = '加载了工具读取文件运行了命令'
    mixed.activities![0]!.items.push({ id: 'tool:shell', kind: 'tool', callId: 'shell' })
    mixed.activities![0]!.items.push({ id: 'tool:search', kind: 'tool', callId: 'search' })
    mixed.tools!.push({
      callId: 'shell',
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: 'sed -n README.md',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed'
    })
    mixed.tools!.push({
      callId: 'search',
      toolId: 'sandbox.fs.search',
      modelName: 'sandbox_fs_search',
      summary: '查找 agent-graph.ts',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed'
    })
    const { container } = render(<ActivityTimeline task={mixed} />)
    expect(container.querySelector('.activity-group > summary .lucide-wrench')).not.toBeNull()
    expect(container.querySelector('.activity-tool .lucide-book-open')).not.toBeNull()
    expect(container.querySelector('.activity-tool .lucide-square-terminal')).not.toBeNull()
    expect(container.querySelector('.activity-tool .lucide-search')).not.toBeNull()
  })

  it('follows the active tool icon and stops group and tool sheen at terminal state', () => {
    const mixed = task('running')
    mixed.activities![0]!.title = '正在执行 2 项操作'
    mixed.activities![0]!.items.push({ id: 'tool:shell', kind: 'tool', callId: 'shell' })
    mixed.tools!.push({
      callId: 'shell',
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: '执行命令',
      title: '正在执行命令',
      argumentsHash: '',
      activityId: 'research',
      status: 'running'
    })
    const { container, rerender } = render(<ActivityTimeline task={mixed} />)
    expect(
      container.querySelector('.activity-group > summary .lucide-square-terminal')
    ).not.toBeNull()
    expect(screen.getByText('正在执行 2 项操作')).toHaveClass('activity-active-title')
    expect(screen.getByText('正在执行命令')).toHaveClass('activity-active-title')
    mixed.tools![1] = { ...mixed.tools![1]!, title: '已执行命令', status: 'completed' }
    mixed.activities![0]!.title = '已执行 2 项操作'
    rerender(<ActivityTimeline task={{ ...mixed }} />)
    expect(container.querySelector('.activity-group > summary .lucide-wrench')).not.toBeNull()
    expect(screen.getByText('已执行 2 项操作')).not.toHaveClass('activity-active-title')
    expect(screen.getByText('已执行命令')).not.toHaveClass('activity-active-title')
  })

  it('keeps a book group icon when multiple different tools only read files', () => {
    const files = task('running')
    files.activities![0]!.items.push({ id: 'tool:list', kind: 'tool', callId: 'list' })
    files.tools!.push({
      callId: 'list',
      toolId: 'sandbox.fs.list',
      modelName: 'sandbox_fs_list',
      summary: '访问文件目录',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed'
    })
    const { container } = render(<ActivityTimeline task={files} />)
    expect(container.querySelector('.activity-group > summary .lucide-book-open')).not.toBeNull()
  })

  it('renders shell input and output as a terminal transcript without JSON wrappers', () => {
    const shell = task('running')
    shell.tools = [
      {
        callId: 'shell',
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: 'rg needle README.md',
        argumentsHash: '',
        activityId: 'research',
        status: 'completed',
        rawInput: '{"command":"rg","args":["needle","README.md"]}',
        rawOutput:
          '{"stdout":"needle is present.\\n","stderr":"","content":"","result":{"exitCode":0}}'
      }
    ]
    shell.activities![0]!.items = [{ id: 'tool:shell', kind: 'tool', callId: 'shell' }]
    const { container } = render(<ActivityTimeline task={shell} />)
    screen.getByText('rg needle README.md').click()
    expect(container.querySelector('.activity-tool-io pre')?.textContent).toBe(
      '$ rg needle README.md\nneedle is present.'
    )
    expect(container.querySelector('.activity-tool-io')).toHaveTextContent('退出码 0')
    expect(container.querySelector('.activity-tool-io')).not.toHaveTextContent('"stdout"')
  })

  it('does not add a thinking text row to the task group', () => {
    render(<ActivityTimeline task={task('running')} />)
    expect(screen.getByText('正在思考').closest('.activity-group')).toBeNull()
  })

  it('archives completed process closed under an elapsed-time summary', () => {
    render(<ActivityTimeline task={task('succeeded')} />)
    const archive = screen.getByText('用时 2.8 秒').closest('details')
    expect(archive).not.toHaveAttribute('open')
    expect(archive?.querySelector('.activity-chevron')).not.toBeNull()
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  it('uses right-facing arrows for every expandable activity row', () => {
    render(<ActivityTimeline task={task('succeeded')} />)
    const arrows = screen
      .getByRole('region', { name: '任务过程' })
      .querySelectorAll('.activity-chevron')
    expect(arrows).toHaveLength(3)
    for (const arrow of arrows) expect(arrow).toHaveClass('lucide-chevron-right')
  })

  it('uses 16px icons throughout the activity area', () => {
    render(<ActivityTimeline task={task('succeeded')} />)
    const icons = screen.getByRole('region', { name: '任务过程' }).querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      expect(icon).toHaveAttribute('width', '16')
      expect(icon).toHaveAttribute('height', '16')
    }
  })

  it('renders an elapsed line without an arrow when there is no process to expand', () => {
    const empty = task('succeeded')
    empty.activityTimeline = []
    empty.activities = []
    empty.tools = []
    render(<ActivityTimeline task={empty} />)
    expect(screen.getByText('用时 2.8 秒').closest('details')).toBeNull()
    expect(screen.getByRole('region', { name: '任务过程' }).querySelector('svg')).toBeNull()
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
    expect(
      screen.getByText('访问文件 /').closest('.activity-tool')?.querySelector('summary')
    ).toBeNull()
    expect(
      screen
        .getByText('访问文件 /')
        .closest('.activity-tool')
        ?.querySelector('svg.activity-chevron')
    ).toBeNull()
    expect(screen.queryByText('运行结束')).toBeNull()
  })
})
