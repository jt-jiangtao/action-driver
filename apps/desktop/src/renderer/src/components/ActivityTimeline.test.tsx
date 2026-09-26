import { act, fireEvent, render, screen } from '@testing-library/react'
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
      toolId: 'local.shell.run',
      modelName: 'shell_run',
      summary: '读取 README',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed',
      rawInput: '{"command":"cat README.md"}',
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

  it('shows a preparing tool name without an empty activity group or raw arguments', () => {
    const preparing = task('running')
    preparing.activityTimeline = []
    preparing.activities = []
    preparing.tools = []
    preparing.preparingToolName = 'shell_run'
    const { container } = render(<ActivityTimeline task={preparing} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在思考')
    expect(container.querySelector('.activity-group')).toBeNull()
    expect(container).not.toHaveTextContent('command')
  })

  it('names a TypeScript tool while its arguments are still streaming', () => {
    const preparing = task('running')
    preparing.activityTimeline = []
    preparing.activities = []
    preparing.tools = []
    preparing.preparingToolName = 'ts_run'
    render(<ActivityTimeline task={preparing} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在思考')
  })

  it('names a webpage read while its arguments are still streaming', () => {
    const preparing = task('running')
    preparing.activityTimeline = []
    preparing.activities = []
    preparing.tools = []
    preparing.preparingToolName = 'web_open'
    render(<ActivityTimeline task={preparing} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在思考')
  })

  it('shows inline scripts without an interpreter prefix and keeps output', () => {
    for (const [toolId, modelName, source] of [
      ['local.shell.run', 'shell_run', 'echo hello'],
      ['local.python.run', 'python_run', 'print("hello")'],
      ['local.node.run', 'node_run', 'console.log("hello")'],
      ['local.typescript.run', 'ts_run', 'const value: string = "hello"']
    ] as const) {
      const scripted = task('running')
      scripted.tools![0]!.toolId = toolId
      scripted.tools![0]!.modelName = modelName
      scripted.tools![0]!.rawInput = JSON.stringify({ script: source, args: ['one'] })
      scripted.tools![0]!.rawOutput = JSON.stringify({ stdout: 'hello\n', result: { exitCode: 0 } })
      const { container, unmount } = render(<ActivityTimeline task={scripted} />)
      screen.getByText('调研实现').closest('summary')!.click()
      screen.getByText('读取 README').click()
      expect(container.querySelector('.activity-tool-io pre')?.textContent).toBe(
        `${source
          .split('\n')
          .map((line) => `› ${line}`)
          .join('\n')}\n\nhello`
      )
      expect(container.querySelector('.activity-tool-io')).toHaveTextContent('退出码 0')
      expect(container.querySelector('.activity-tool-io')).not.toHaveTextContent('"script"')
      unmount()
    }
  })

  it('summarizes image generation instead of dumping transport JSON', () => {
    const image = task('running')
    image.tools = [
      {
        callId: 'image',
        toolId: 'image.generate',
        modelName: 'image_generate',
        summary: '生成 2 张图片',
        argumentsHash: '',
        activityId: 'research',
        status: 'completed',
        rawInput: JSON.stringify({
          images: [
            { prompt: '一只在雨中的猫' },
            {
              prompt:
                'A cozy Japanese countryside cottage in autumn, surrounded by red maple trees and a small stream, warm golden sunlight filtering through leaves, Studio Ghibli inspired illustration'
            }
          ]
        }),
        rawOutput: JSON.stringify({
          stdout: '',
          stderr: '',
          content: '',
          result: { succeeded: 2, failed: 0 },
          byteLength: 26,
          truncated: false
        })
      }
    ]
    image.activities![0]!.items = [{ id: 'tool:image', kind: 'tool', callId: 'image' }]
    const { container } = render(<ActivityTimeline task={image} />)
    screen.getByText('生成 2 张图片').click()

    const panel = container.querySelector('.activity-tool-io')
    expect(panel).toHaveTextContent('已生成 2 张图片')
    expect(panel).toHaveTextContent('一只在雨中的猫')
    expect(panel).toHaveTextContent(
      'A cozy Japanese countryside cottage in autumn, surrounded by red maple trees and a small stream, warm golden sunlight filtering through leaves, Studio Ghibli inspired illustration'
    )
    expect(panel).not.toHaveTextContent('…')
    expect(panel).not.toHaveTextContent('stdout')
    expect(panel).not.toHaveTextContent('byteLength')
  })

  it('marks blank script lines so they stay distinguishable from output', () => {
    const scripted = task('running')
    scripted.tools![0]!.toolId = 'local.python.run'
    scripted.tools![0]!.rawInput = JSON.stringify({ script: 'print("a")\n\nprint("b")', args: [] })
    scripted.tools![0]!.rawOutput = JSON.stringify({ stdout: 'a\nb\n', result: { exitCode: 0 } })
    const { container } = render(<ActivityTimeline task={scripted} />)
    screen.getByText('调研实现').closest('summary')!.click()
    screen.getByText('读取 README').click()

    expect(container.querySelector('.activity-tool-io pre')?.textContent).toBe(
      '› print("a")\n›\n› print("b")\n\na\nb'
    )
  })

  it('hides the indicator while image placeholders are showing progress', () => {
    const generating = task('running')
    generating.tools = [
      {
        callId: 'image',
        toolId: 'image.generate',
        modelName: 'image_generate',
        summary: '生成 4 张图片',
        argumentsHash: '',
        activityId: 'research',
        status: 'running',
        imageCount: 4
      }
    ]
    render(<ActivityTimeline task={generating} />)
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  it('hides the indicator while process text is streaming in the same response', () => {
    const preparing = task('running')
    preparing.activityTimeline = [
      { id: 'text:plan', kind: 'text', content: '先检查输入', phase: 'pending' }
    ]
    preparing.activities = []
    preparing.tools = []
    preparing.preparingToolName = 'python_run'
    render(<ActivityTimeline task={preparing} />)
    expect(screen.getByText('先检查输入')).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('uses the imagegen mark for an image generation group', () => {
    const image = task('running')
    image.activities![0]!.title = '已完成随意生成一张图片'
    image.tools = [
      {
        callId: 'image',
        toolId: 'image.generate',
        modelName: 'image_generate',
        summary: '生成图片',
        argumentsHash: '',
        activityId: 'research',
        status: 'completed'
      }
    ]
    image.activities![0]!.items = [{ id: 'tool:image', kind: 'tool', callId: 'image' }]
    const { container } = render(<ActivityTimeline task={image} />)

    expect(container.querySelector('.activity-group > summary .lucide-image')).not.toBeNull()
    expect(container.querySelector('.activity-group > summary .lucide-layers')).toBeNull()
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
      document.querySelector('.activity-tool .lucide-square-terminal')
    )
    expect(screen.queryByText('⌘')).not.toBeInTheDocument()
    expect(screen.queryByText('输入与输出')).not.toBeInTheDocument()
    screen.getByText('读取 README').click()
    expect(document.querySelector('.activity-tool-io pre')?.textContent).toContain('内容')
  })

  it('shows a shell summary without file-specific decoration', () => {
    const read = task('running')
    read.tools![0]!.summary = '访问文件 README.md'
    const { container } = render(<ActivityTimeline task={read} />)
    expect(container.querySelector('.activity-tool-label')).toHaveTextContent('访问文件 README.md')
    expect(container.querySelector('.activity-tool-path')).toBeNull()
  })

  it('uses a distinct group icon for mixed tools and per-tool child icons', () => {
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
      toolId: 'web.search',
      modelName: 'web_search',
      summary: '查找 agent-graph.ts',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed'
    })
    const { container } = render(<ActivityTimeline task={mixed} />)
    expect(container.querySelector('.activity-group > summary .lucide-layers')).not.toBeNull()
    expect(container.querySelector('.activity-tool .lucide-square-terminal')).not.toBeNull()
    expect(container.querySelector('.activity-tool .lucide-globe-2')).not.toBeNull()
  })

  it('marks Computer Use tool rows and groups with the pointer icon', () => {
    const computer = task('succeeded')
    computer.activities![0]!.title = '已操作电脑'
    computer.activities![0]!.items = ['observe', 'capture', 'act', 'permissions'].map((name) => ({
      id: `tool:${name}`, kind: 'tool' as const, callId: name
    }))
    computer.tools = ['observe', 'capture', 'act', 'permissions'].map((name) => ({
      callId: name,
      toolId: `computer.${name}`,
      modelName: `computer_${name}`,
      summary: name,
      argumentsHash: '',
      activityId: 'research',
      status: 'completed' as const
    }))
    const { container } = render(<ActivityTimeline task={computer} />)
    expect(container.querySelector('.activity-group > summary .lucide-mouse-pointer-2')).not.toBeNull()
    expect(container.querySelectorAll('.activity-tool .lucide-mouse-pointer-2')).toHaveLength(4)
    expect(container.querySelector('.activity-tool .lucide-boxes')).toBeNull()
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
    expect(
      container.querySelector('.activity-group > summary .lucide-square-terminal')
    ).not.toBeNull()
    expect(screen.getByText('已执行 2 项操作')).not.toHaveClass('activity-active-title')
    expect(screen.getByText('已执行命令')).not.toHaveClass('activity-active-title')
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
      '$ rg needle README.md\n\nneedle is present.'
    )
    expect(container.querySelector('.activity-tool-io')).toHaveTextContent('退出码 0')
    expect(container.querySelector('.activity-tool-io')).not.toHaveTextContent('"stdout"')
  })

  it('renders a webpage title, source and text instead of raw JSON', () => {
    const open = vi.fn(async () => {})
    vi.stubGlobal('actionDriverDesktop', { externalLinks: { open } })
    const reading = task('running')
    reading.activities![0]!.title = '已读取网页'
    reading.tools![0] = {
      callId: 'read',
      toolId: 'web.open',
      modelName: 'web_open',
      title: '已读取网页 example.com',
      summary: '读取 example.com',
      argumentsHash: '',
      activityId: 'research',
      status: 'completed',
      rawInput: '{"url":"https://example.com/start"}',
      rawOutput: JSON.stringify({
        result: {
          title: '页面标题',
          url: 'https://example.com/final',
          text: '正文内容',
          truncated: true
        }
      })
    }
    const { container, rerender } = render(<ActivityTimeline task={reading} />)
    screen.getByText('已读取网页').closest('summary')!.click()
    screen.getByText('已读取网页 example.com').click()
    expect(screen.getByText('页面标题')).toBeVisible()
    expect(screen.getByRole('link', { name: 'https://example.com/final' })).toHaveAttribute(
      'href',
      'https://example.com/final'
    )
    expect(screen.getByRole('link', { name: 'https://example.com/final' })).toHaveAttribute(
      'data-testid',
      'e2e/tasks/detail/activity/web-open/source#link'
    )
    fireEvent.click(screen.getByRole('link', { name: 'https://example.com/final' }))
    expect(open).toHaveBeenCalledWith('https://example.com/final')
    expect(screen.getByText('正文内容')).toBeVisible()
    expect(screen.getByText('内容已截断')).toBeVisible()
    expect(container.querySelector('.activity-tool-io')).not.toHaveTextContent('"result"')
    expect(container.querySelector('.activity-tool-io')).not.toHaveTextContent('"rawInput"')

    rerender(<ActivityTimeline task={{ ...reading, status: 'succeeded' }} />)
    screen.getByTestId('e2e/tasks/detail/activity/archive#button').click()
    expect(screen.getByText('页面标题')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('renders Python and Node input as expandable terminal details', () => {
    for (const [toolId, modelName, title, input, command] of [
      [
        'local.python.run',
        'python_run',
        '已运行 Python',
        '{"code":"print(1)"}',
        '$ python3 -c "print(1)"'
      ],
      [
        'local.node.run',
        'node_run',
        '已运行 Node.js',
        '{"file":"script.js","args":["hi"]}',
        '$ node "script.js" hi'
      ]
    ] as const) {
      const script = task('running')
      script.tools = [
        {
          callId: 'script',
          toolId,
          modelName,
          title,
          summary: title,
          argumentsHash: '',
          activityId: 'research',
          status: 'completed',
          rawInput: input,
          rawOutput: '{"stdout":"1\\n","result":{"exitCode":0}}'
        }
      ]
      script.activities![0]!.items = [{ id: 'tool:script', kind: 'tool', callId: 'script' }]
      const { container, unmount } = render(<ActivityTimeline task={script} />)
      screen.getByText(title).click()
      expect(container.querySelector('.activity-tool-io pre')?.textContent).toContain(command)
      expect(container.querySelector('.activity-tool-io')).toHaveTextContent('退出码 0')
      unmount()
    }
  })

  it('does not flash the thinking row while an activity group is still current', () => {
    render(<ActivityTimeline task={task('running')} />)
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  it('archives completed process closed under an elapsed-time summary', () => {
    render(<ActivityTimeline task={task('succeeded')} />)
    const archive = screen.getByText('用时 3 秒').closest('details')
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
    expect(screen.getByText('用时 3 秒').closest('details')).toBeNull()
    expect(screen.getByRole('region', { name: '任务过程' }).querySelector('svg')).toBeNull()
  })

  it('renders a standalone tool from a snapshot task in the same timeline', () => {
    const standalone = task('succeeded')
    standalone.activities = []
    standalone.activityTimeline = []
    standalone.tools = [
      {
        callId: 'list',
        toolId: 'local.shell.run',
        modelName: 'shell_run',
        summary: '访问文件 /',
        argumentsHash: '',
        activityId: null,
        status: 'completed',
        durationMs: 8,
        resultSummary: '已完成'
      }
    ]
    render(<ActivityTimeline task={standalone} />)
    screen.getByText('用时 3 秒').click()
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
