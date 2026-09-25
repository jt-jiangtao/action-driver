import type { TaskProjection } from '@actiondriver/contracts'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import { StreamTaskProjection } from './stream-task-projection'

const identity = {
  protocol: 'actiondriver.stream.v2' as const,
  cursor: 2,
  sequence: 0,
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'assistant-1',
  occurredAt: '2026-09-23T00:00:00.000Z'
}

const task = (): TaskProjection => ({
  id: 'task-1',
  sessionId: 'session-1',
  title: '写代码',
  status: 'running',
  model: { connectionId: 'connection-1', modelId: 'qwen3.7-max' },
  messages: [
    { id: 'user-1', role: 'user', content: '写代码' },
    { id: 'assistant-1', role: 'agent', content: '' }
  ],
  steps: [{ id: 'agent', title: 'Agent 执行', detail: 'Agent 正在执行', state: 'current' }],
  browser: null
})

function content(sequence: number, delta: string, eventId = `content-${sequence}`) {
  return {
    type: 'response.content' as const,
    ...identity,
    eventId,
    cursor: sequence + 2,
    sequence,
    delta,
    contentIndex: 0
  }
}

function start(): StreamServerEvent {
  return {
    type: 'response.start',
    ...identity,
    eventId: 'start-1',
    sequence: 0,
    model: { connectionId: 'connection-1', modelId: 'qwen3.7-max' }
  }
}

describe('StreamTaskProjection', () => {
  it('projects generated images once and retains them after final text and snapshot', () => {
    const image = {
      assetId: 'asset-1',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'response.image',
      ...identity,
      eventId: 'image-1',
      cursor: 1,
      sequence: 0,
      asset: image,
      contentIndex: 0,
      callId: 'call-1',
      index: 0
    })
    projection.apply({
      type: 'response.image',
      ...identity,
      eventId: 'image-1',
      cursor: 1,
      sequence: 0,
      asset: image,
      contentIndex: 0,
      callId: 'call-1',
      index: 0
    })
    projection.apply({
      type: 'response.end',
      ...identity,
      eventId: 'end-image',
      cursor: 2,
      sequence: 1,
      status: 'completed',
      content: '完成',
      finishReason: 'stop',
      usage: null,
      durationMs: 10,
      error: null
    })
    expect(projection.snapshot()?.messages.at(-1)).toMatchObject({
      content: '完成',
      parts: [
        { kind: 'text', text: '完成' },
        { kind: 'image', asset: image }
      ]
    })
    projection.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'snapshot-image',
      cursor: 3,
      sequence: 2,
      status: 'completed',
      messages: [
        { id: 'user-1', role: 'user', content: '写代码', createdAt: identity.occurredAt },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '完成',
          parts: [
            { kind: 'image', asset: image },
            { kind: 'text', text: '完成' }
          ],
          createdAt: identity.occurredAt
        }
      ],
      tools: [],
      error: null
    })
    expect(projection.snapshot()?.messages.at(-1)?.parts).toHaveLength(2)
    expect(projection.snapshot()?.messages.at(-1)?.parts?.[0]).toEqual({ kind: 'text', text: '完成' })
  })
  it('shows tool preparation only while the model is preparing its call', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply(start())
    projection.apply({
      type: 'response.tool_preparing',
      ...identity,
      eventId: 'preparing-1',
      cursor: 3,
      sequence: 1,
      index: 0,
      modelName: 'shell_run'
    })
    expect(projection.snapshot()).toMatchObject({ preparingToolName: 'shell_run' })
    projection.apply({
      type: 'tool.proposed',
      ...identity,
      eventId: 'proposed-1',
      cursor: 4,
      sequence: 2,
      callId: 'call-1',
      callSequence: 0,
      toolId: 'local.shell.run',
      modelName: 'shell_run',
      summary: '执行命令',
      argumentsHash: 'hash',
      activityId: null
    })
    expect(projection.snapshot()?.preparingToolName).toBeUndefined()
  })

  it('preserves partial content and shows unknown tool outcome after Runtime interruption', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach({
      ...task(),
      streamCursor: 5,
      streamSequence: 2,
      messages: [
        { id: 'user-1', role: 'user', content: '写代码' },
        { id: 'assistant-1', role: 'agent', content: '部分结果' }
      ]
    })
    projection.apply({
      type: 'tool.unknown',
      ...identity,
      eventId: 'unknown-tool',
      cursor: 6,
      sequence: 3,
      callId: 'call-1',
      callSequence: 2,
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: '运行命令',
      argumentsHash: 'hash',
      activityId: null,
      error: { code: 'TOOL_OUTCOME_UNKNOWN', message: '工具结果未知', retryable: false }
    })
    projection.apply({
      type: 'runtime.interrupted',
      ...identity,
      eventId: 'interrupted',
      cursor: 7,
      sequence: 4,
      error: { code: 'RUNTIME_RESTARTED', message: 'Runtime 异常退出', retryable: false }
    })
    expect(projection.snapshot()).toMatchObject({
      status: 'failed',
      streamSequence: 4,
      messages: [{ role: 'user' }, { role: 'agent', content: '部分结果' }],
      tools: [{ callId: 'call-1', status: 'unknown', errorSummary: '工具结果未知' }]
    })
  })

  it('applies response content after accepted and activity events in one request sequence', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'request.accepted',
      ...identity,
      eventId: 'accepted-interleaved',
      cursor: 1,
      sequence: 0
    })
    projection.apply({
      type: 'response.start',
      ...identity,
      eventId: 'start-interleaved',
      cursor: 3,
      sequence: 1,
      model: { connectionId: 'connection-1', modelId: 'qwen3.7-max' }
    })
    projection.apply({
      type: 'activity.started',
      ...identity,
      eventId: 'activity-interleaved',
      cursor: 5,
      sequence: 2,
      activityId: 'research',
      title: '调研',
      titleRevision: 1
    })
    projection.apply({
      type: 'response.content',
      ...identity,
      eventId: 'content-interleaved',
      cursor: 7,
      sequence: 3,
      delta: '已完成',
      contentIndex: 0
    })
    expect(projection.snapshot()).toMatchObject({
      streamCursor: 7,
      streamSequence: 3,
      messages: [{ role: 'user' }, { role: 'agent', content: '已完成' }]
    })
  })

  it('does not replay buffered events already included in the task.get high-water snapshot', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.apply({
      type: 'activity.text',
      ...identity,
      eventId: 'already-text',
      cursor: 3,
      activityId: 'research',
      textId: 'plan:task',
      delta: '正文 A'
    })
    projection.apply({ ...content(1, '正文 A'), cursor: 4 })
    projection.attach({
      ...task(),
      streamCursor: 4,
      streamSequence: 1,
      messages: [
        { id: 'user-1', role: 'user', content: '写代码' },
        { id: 'assistant-1', role: 'agent', content: '正文 A' }
      ],
      activities: [
        {
          activityId: 'research',
          title: '调研',
          titleRevision: 1,
          status: 'running',
          items: [{ id: 'text:plan:task', kind: 'text', content: '正文 A', phase: 'process' }]
        }
      ],
      activityTimeline: [{ id: 'activity:research', kind: 'activity', activityId: 'research' }]
    })
    expect(projection.snapshot()?.activities?.[0]?.items[0]).toMatchObject({ content: '正文 A' })
    expect(projection.snapshot()?.messages.at(-1)?.content).toBe('正文 A')
  })

  it('matches a cursor-consistent snapshot for interleaved process text and tool calls', () => {
    const events: StreamServerEvent[] = [
      {
        type: 'activity.started',
        ...identity,
        eventId: 'a1',
        cursor: 2,
        activityId: 'research',
        title: '调研',
        titleRevision: 1
      },
      {
        type: 'activity.text',
        ...identity,
        eventId: 'a2',
        cursor: 3,
        sequence: 1,
        activityId: 'research',
        textId: 'plan:task',
        delta: '正文 A'
      },
      {
        type: 'tool.proposed',
        ...identity,
        eventId: 'a3',
        cursor: 4,
        sequence: 2,
        callId: 'call-a',
        callSequence: 0,
        toolId: 'shell',
        modelName: 'shell',
        summary: '工具 A',
        argumentsHash: 'hash',
        activityId: 'research'
      },
      {
        type: 'activity.text.done',
        ...identity,
        eventId: 'a4',
        cursor: 5,
        sequence: 3,
        activityId: 'research',
        textId: 'plan:task',
        phase: 'process'
      },
      {
        type: 'activity.text',
        ...identity,
        eventId: 'a5',
        cursor: 6,
        sequence: 4,
        activityId: 'research',
        textId: 'plan:task:1',
        delta: '正文 B'
      },
      {
        type: 'tool.proposed',
        ...identity,
        eventId: 'a6',
        cursor: 7,
        sequence: 5,
        callId: 'call-b',
        callSequence: 0,
        toolId: 'shell',
        modelName: 'shell',
        summary: '工具 B',
        argumentsHash: 'hash',
        activityId: 'research'
      },
      {
        type: 'activity.text.done',
        ...identity,
        eventId: 'a7',
        cursor: 8,
        sequence: 6,
        activityId: 'research',
        textId: 'plan:task:1',
        phase: 'final'
      }
    ]
    const live = new StreamTaskProjection({ onChange: vi.fn() })
    live.attach(task())
    for (const event of events) live.apply(event)
    const activity = live.snapshot()?.activities?.[0]
    expect(activity?.items.map((item) => item.id)).toEqual([
      'text:plan:task',
      'tool:call-a',
      'text:plan:task:1',
      'tool:call-b'
    ])
    expect(activity?.items.find((item) => item.id === 'text:plan:task:1')).toMatchObject({
      phase: 'final'
    })

    const restored = new StreamTaskProjection({ onChange: vi.fn() })
    restored.attach(task())
    restored.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'snapshot-interleaved',
      cursor: 8,
      sequence: 6,
      status: 'running',
      messages: [],
      tools: [
        {
          callId: 'call-a',
          toolId: 'shell',
          modelName: 'shell',
          summary: '工具 A',
          argumentsHash: 'hash',
          status: 'proposed',
          durationMs: 0,
          activityId: 'research'
        },
        {
          callId: 'call-b',
          toolId: 'shell',
          modelName: 'shell',
          summary: '工具 B',
          argumentsHash: 'hash',
          status: 'proposed',
          durationMs: 0,
          activityId: 'research'
        }
      ],
      activities: live.snapshot()?.activities,
      activityTimeline: live.snapshot()?.activityTimeline,
      error: null
    })
    expect(restored.snapshot()?.activities).toEqual(live.snapshot()?.activities)
    expect(restored.snapshot()?.activityTimeline).toEqual(live.snapshot()?.activityTimeline)
  })

  it('uses the response start time for a running activity clock', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply(start())
    expect(projection.snapshot()?.activityStartedAt).toBe('2026-09-23T00:00:00.000Z')
  })

  it('keeps tool approval state separate from assistant Markdown', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'tool.waiting_approval',
      ...identity,
      eventId: 'tool-waiting',
      callId: 'call-1',
      callSequence: 1,
      toolId: 'sandbox.shell.run',
      modelName: 'sandbox_shell_run',
      summary: 'rg TODO README.md',
      title: '正在执行命令',
      argumentsHash: 'sha256:abc',
      activityId: null
    })
    expect(projection.snapshot()?.tools).toEqual([
      expect.objectContaining({
        callId: 'call-1',
        status: 'waiting_approval',
        title: '正在执行命令'
      })
    ])
    expect(projection.snapshot()?.messages.at(-1)?.content).toBe('')
  })

  it('projects a dynamic activity with ordered text and tools without grouping by tool type', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'activity.started',
      ...identity,
      eventId: 'activity-start',
      cursor: 2,
      activityId: 'research',
      title: '调研并核对现有实现',
      titleRevision: 1
    })
    projection.apply({
      type: 'activity.text',
      ...identity,
      eventId: 'activity-text',
      cursor: 3,
      sequence: 1,
      activityId: 'research',
      delta: '已读取协议。'
    })
    projection.apply({
      type: 'tool.completed',
      ...identity,
      eventId: 'activity-tool',
      cursor: 4,
      sequence: 2,
      callId: 'call-research',
      callSequence: 1,
      toolId: 'web.search',
      modelName: 'web_search',
      summary: '搜索活动协议',
      argumentsHash: 'sha256:research',
      activityId: 'research',
      durationMs: 42,
      resultSummary: '已找到规范'
    })
    projection.apply({
      type: 'activity.updated',
      ...identity,
      eventId: 'activity-update',
      cursor: 5,
      sequence: 3,
      activityId: 'research',
      title: '已核对现有实现',
      titleRevision: 2
    })
    projection.apply({
      type: 'activity.completed',
      ...identity,
      eventId: 'activity-complete',
      cursor: 6,
      sequence: 4,
      activityId: 'research'
    })

    expect(projection.snapshot()?.activityTimeline).toEqual([
      { id: 'activity:research', kind: 'activity', activityId: 'research' }
    ])
    expect(projection.snapshot()?.activities).toEqual([
      expect.objectContaining({
        activityId: 'research',
        title: '已核对现有实现',
        titleRevision: 2,
        status: 'completed',
        items: [
          { id: 'text:activity-text', kind: 'text', content: '已读取协议。', phase: 'pending' },
          { id: 'tool:call-research', kind: 'tool', callId: 'call-research' }
        ]
      })
    ])
  })

  it('keeps activity-less text between activities as a standalone timeline item', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'activity.text',
      ...identity,
      eventId: 'between-activities',
      activityId: null,
      delta: '已完成第一阶段，开始下一阶段。'
    })
    expect(projection.snapshot()?.activityTimeline).toEqual([
      {
        id: 'text:between-activities',
        kind: 'text',
        content: '已完成第一阶段，开始下一阶段。',
        phase: 'pending'
      }
    ])
    expect(projection.snapshot()?.activities).toEqual([])
    projection.apply({
      type: 'activity.started',
      ...identity,
      eventId: 'first-tool-activity',
      cursor: 3,
      sequence: 1,
      activityId: 'first-tool',
      title: '正在读取文件',
      titleRevision: 1
    })
    projection.apply({
      type: 'tool.running',
      ...identity,
      eventId: 'first-tool-running',
      cursor: 4,
      sequence: 2,
      callId: 'call-first',
      callSequence: 1,
      toolId: 'local.shell.run',
      modelName: 'shell_run',
      summary: '读取 README',
      argumentsHash: '',
      activityId: 'first-tool'
    })
    const restored = new StreamTaskProjection({ onChange: vi.fn() })
    restored.attach(projection.snapshot()!)
    expect(restored.snapshot()?.activityTimeline).toEqual([
      {
        id: 'text:between-activities',
        kind: 'text',
        content: '已完成第一阶段，开始下一阶段。',
        phase: 'pending'
      },
      { id: 'activity:first-tool', kind: 'activity', activityId: 'first-tool' }
    ])
    expect(restored.snapshot()?.activities).toEqual([
      expect.objectContaining({
        activityId: 'first-tool',
        title: '正在读取文件',
        items: [{ id: 'tool:call-first', kind: 'tool', callId: 'call-first' }]
      })
    ])
  })

  it('orders an activity and its tool by global cursor after upstream buffering', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'activity.started',
      ...identity,
      eventId: 'early-activity',
      cursor: 4,
      activityId: 'research',
      title: '调研并核对现有实现',
      titleRevision: 1
    })
    projection.apply({
      type: 'tool.completed',
      ...identity,
      eventId: 'late-tool',
      cursor: 5,
      sequence: 1,
      callId: 'call-cursor',
      callSequence: 3,
      toolId: 'local.shell.run',
      modelName: 'shell_run',
      summary: '已读取 README.md',
      argumentsHash: '',
      activityId: 'research',
      durationMs: 1,
      resultSummary: '工具已完成'
    })

    expect(projection.snapshot()?.activities?.[0]?.items).toEqual([
      { id: 'tool:call-cursor', kind: 'tool', callId: 'call-cursor' }
    ])
  })

  it('keeps an activity-less tool as one chronological timeline entry instead of falling back to legacy cards', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'tool.completed',
      ...identity,
      eventId: 'standalone-tool',
      cursor: 3,
      callId: 'call-standalone',
      callSequence: 2,
      toolId: 'local.shell.run',
      modelName: 'shell_run',
      summary: '访问文件 /',
      argumentsHash: '',
      activityId: null,
      durationMs: 8,
      resultSummary: '工具已完成'
    })

    expect(projection.snapshot()?.activityTimeline).toEqual([
      { id: 'tool:call-standalone', kind: 'tool', callId: 'call-standalone' }
    ])
  })

  it('keeps a terminal tool summary and duration for the completed activity card', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'tool.completed',
      ...identity,
      eventId: 'tool-completed',
      callId: 'call-1',
      callSequence: 1,
      toolId: 'web.search',
      modelName: 'web_search',
      summary: 'ActionDriver',
      argumentsHash: 'sha256:abc',
      activityId: null,
      durationMs: 42,
      resultSummary: 'A safe title'
    })
    expect(projection.snapshot()?.tools).toEqual([
      expect.objectContaining({
        callId: 'call-1',
        status: 'completed',
        resultSummary: 'A safe title',
        durationMs: 42
      })
    ])
  })

  it('restores pending tool approval from an authoritative snapshot after a page reload', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'snapshot-tools',
      sequence: 0,
      status: 'running',
      messages: [
        { id: 'user-1', role: 'user', content: '写代码', createdAt: identity.occurredAt },
        { id: 'assistant-1', role: 'assistant', content: '', createdAt: identity.occurredAt }
      ],
      tools: [
        {
          callId: 'call-1',
          toolId: 'sandbox.shell.run',
          modelName: 'sandbox_shell_run',
          summary: 'rg TODO README.md',
          argumentsHash: 'sha256:abc',
          status: 'waiting_approval',
          durationMs: 0
        }
      ],
      error: null
    })
    expect(projection.snapshot()?.tools).toEqual([
      expect.objectContaining({ callId: 'call-1', status: 'waiting_approval' })
    ])
    expect(projection.snapshot()?.messages.at(-1)?.content).toBe('')
  })

  it('restores all sixteen pending image slots from an authoritative snapshot', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'snapshot-image-slots',
      sequence: 0,
      status: 'running',
      messages: [],
      tools: [
        {
          callId: 'call-images',
          toolId: 'image.generate',
          modelName: 'image_generate',
          summary: '生成图片',
          argumentsHash: '',
          status: 'running',
          durationMs: 0,
          imageCount: 16
        }
      ],
      error: null
    })

    expect(projection.snapshot()?.tools).toEqual([
      expect.objectContaining({ callId: 'call-images', imageCount: 16 })
    ])
  })

  it('restores the snapshot activity timeline and raw tool I/O after a reload', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'snapshot-with-activity',
      sequence: 4,
      status: 'completed',
      messages: [],
      tools: [
        {
          callId: 'call-snapshot-activity',
          toolId: 'local.shell.run',
          modelName: 'shell_run',
          summary: '读取 README.md',
          argumentsHash: '',
          status: 'completed',
          durationMs: 6,
          resultSummary: '已读取',
          activityId: 'research',
          rawInput: '{"path":"README.md"}',
          rawOutput: 'README 内容',
          rawOutputTruncated: false
        }
      ],
      activities: [
        {
          activityId: 'research',
          title: '核对实现',
          titleRevision: 2,
          status: 'completed',
          items: [
            { id: 'tool:call-snapshot-activity', kind: 'tool', callId: 'call-snapshot-activity' }
          ]
        }
      ],
      activityTimeline: [{ id: 'activity:research', kind: 'activity', activityId: 'research' }],
      error: null
    })

    expect(projection.snapshot()).toMatchObject({
      activities: [expect.objectContaining({ title: '核对实现' })],
      activityTimeline: [{ id: 'activity:research', kind: 'activity', activityId: 'research' }],
      tools: [
        expect.objectContaining({
          activityId: 'research',
          rawInput: '{"path":"README.md"}',
          rawOutput: 'README 内容'
        })
      ]
    })
  })
  it('buffers early content, joins split Markdown, and coalesces notifications', () => {
    const scheduled: Array<() => void> = []
    const onChange = vi.fn()
    const projection = new StreamTaskProjection({
      onChange,
      schedule: (callback) => {
        scheduled.push(callback)
        return callback
      },
      cancelScheduled: vi.fn()
    })

    projection.apply(start())
    projection.apply(content(1, '```ts\nconst '))
    projection.apply(content(2, 'ok = true\n```'))
    projection.attach(task())

    expect(scheduled).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    scheduled[0]?.()
    expect(onChange).toHaveBeenCalledOnce()
    expect(projection.snapshot()?.messages.at(-1)?.content).toBe('```ts\nconst ok = true\n```')
  })

  it('ignores duplicate, old, gapped, and non-matching content events', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply(start())
    projection.apply(content(1, 'A'))
    projection.apply(content(1, 'duplicate', 'content-1'))
    projection.apply(content(0, 'old', 'old'))
    projection.apply(content(3, 'gap', 'gap'))
    projection.apply({ ...content(2, 'wrong'), messageId: 'other-message' })
    projection.flush()

    expect(projection.snapshot()?.messages.at(-1)?.content).toBe('A')
  })

  it.each([
    ['completed', 'succeeded'],
    ['failed', 'failed'],
    ['cancelled', 'paused']
  ] as const)(
    'reconciles %s terminal state and preserves authoritative content',
    (status, expected) => {
      const projection = new StreamTaskProjection({ onChange: vi.fn() })
      projection.attach(task())
      projection.apply(start())
      projection.apply(content(1, 'partial'))
      projection.apply({
        type: 'response.end',
        ...identity,
        eventId: `end-${status}`,
        cursor: 4,
        sequence: 2,
        status,
        content: 'authoritative final',
        finishReason: status === 'completed' ? 'stop' : null,
        usage: null,
        durationMs: 10,
        error:
          status === 'completed'
            ? null
            : { code: status, message: `${status} detail`, retryable: false }
      })

      expect(projection.snapshot()).toMatchObject({
        status: expected,
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'assistant-1', content: 'authoritative final' })
        ])
      })
      if (status !== 'completed') {
        expect(projection.snapshot()?.steps.at(-1)?.detail).toContain(`${status} detail`)
      }
    }
  )

  it('returns immutable snapshots', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    const external = projection.snapshot()!
    external.messages[0]!.content = 'mutated'
    expect(projection.snapshot()?.messages[0]?.content).toBe('写代码')
  })
})
