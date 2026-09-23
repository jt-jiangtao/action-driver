import type { TaskProjection } from '@actiondriver/contracts'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import { describe, expect, it, vi } from 'vitest'
import { StreamTaskProjection } from './stream-task-projection'

const identity = {
  protocol: 'actiondriver.stream.v1' as const,
  cursor: 2,
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
        activityId: 'research',
        textId: 'plan:task',
        delta: '正文 A'
      },
      {
        type: 'tool.proposed',
        ...identity,
        eventId: 'a3',
        cursor: 4,
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
        activityId: 'research',
        textId: 'plan:task',
        phase: 'process'
      },
      {
        type: 'activity.text',
        ...identity,
        eventId: 'a5',
        cursor: 6,
        activityId: 'research',
        textId: 'plan:task:1',
        delta: '正文 B'
      },
      {
        type: 'tool.proposed',
        ...identity,
        eventId: 'a6',
        cursor: 7,
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
      sequence: 0,
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
      argumentsHash: 'sha256:abc',
      activityId: null
    })
    expect(projection.snapshot()?.tools).toEqual([
      expect.objectContaining({ callId: 'call-1', status: 'waiting_approval' })
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
      activityId: 'research',
      delta: '已读取协议。'
    })
    projection.apply({
      type: 'tool.completed',
      ...identity,
      eventId: 'activity-tool',
      cursor: 4,
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
      activityId: 'research',
      title: '已核对现有实现',
      titleRevision: 2
    })
    projection.apply({
      type: 'activity.completed',
      ...identity,
      eventId: 'activity-complete',
      cursor: 6,
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
      callId: 'call-cursor',
      callSequence: 3,
      toolId: 'sandbox.fs.read',
      modelName: 'sandbox_fs_read',
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
      toolId: 'sandbox.fs.list',
      modelName: 'sandbox_fs_list',
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
          toolId: 'sandbox.fs.read',
          modelName: 'sandbox_fs_read',
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
