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
  it('merges asset-only details with preceding semantic output', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    const input = [{ label: 'Code', kind: 'code' as const, value: 'capture()' }]
    const output = [{ label: 'Log', kind: 'text' as const, value: 'captured' }]
    const base = {
      ...identity,
      callId: 'call',
      toolId: 'capture',
      modelName: 'capture',
      summary: 'capture',
      argumentsHash: '',
      activityId: null
    }
    projection.apply({
      ...base,
      type: 'tool.running',
      eventId: 'run',
      sequence: 0,
      callSequence: 0,
      details: { input, output }
    })
    const asset = {
      assetId: 'image',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 1,
      source: 'generated' as const
    }
    const image = { label: 'Image 1', kind: 'image' as const, value: 'image', asset }
    projection.apply({
      ...base,
      type: 'tool.asset',
      eventId: 'asset',
      cursor: 3,
      sequence: 1,
      callSequence: 1,
      index: 0,
      asset,
      details: { input, output: [image] }
    })
    expect(projection.snapshot()?.tools?.[0]?.details).toEqual({
      input,
      output: [...output, image]
    })
  })

  it('keeps semantic inputs while aggregating streamed output and partial failure details', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    const presentation = {
      input: [{ label: 'Command', path: 'command', kind: 'code' as const }],
      output: [{ label: 'Output', path: 'stdout', kind: 'code' as const }]
    }
    const base = {
      ...identity,
      callId: 'call',
      toolId: 'shell',
      modelName: 'shell',
      summary: 'run',
      argumentsHash: '',
      activityId: null,
      presentation,
      details: { input: [{ label: 'Command', kind: 'code' as const, value: 'pwd' }], output: [] }
    }
    projection.apply({
      ...base,
      type: 'tool.running',
      eventId: 'run',
      sequence: 0,
      callSequence: 0
    })
    projection.apply({
      ...base,
      type: 'tool.content',
      eventId: 'c1',
      sequence: 1,
      cursor: 3,
      callSequence: 1,
      stream: 'stdout',
      delta: 'hello '
    })
    projection.apply({
      ...base,
      type: 'tool.content',
      eventId: 'c2',
      sequence: 2,
      cursor: 4,
      callSequence: 2,
      stream: 'stdout',
      delta: 'world'
    })
    expect(projection.snapshot()?.tools?.[0]?.details).toEqual({
      input: base.details.input,
      output: [{ label: 'Output', kind: 'code', value: 'hello world' }]
    })
    projection.apply({
      ...base,
      type: 'tool.failed',
      eventId: 'fail',
      sequence: 3,
      cursor: 5,
      callSequence: 3,
      error: { code: 'FAIL', message: 'failed', retryable: false }
    })
    expect(projection.snapshot()?.tools?.[0]?.details?.output[0]?.value).toBe('hello world')
  })

  it('projects application requests and clears cancelled or historical waiters', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    const approval = {
      requestId: 'approval-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      target: {
        bundleId: 'com.apple.Notes',
        displayName: 'Notes',
        appPath: '/System/Applications/Notes.app',
        risk: 'low' as const
      },
      allowPersistentApproval: true
    }
    projection.apply({
      type: 'computer.app-approval.requested',
      ...identity,
      eventId: 'approval-request',
      sequence: 0,
      cursor: 1,
      approval
    })
    expect(projection.snapshot()?.pendingAppApproval).toEqual([approval])
    expect(projection.snapshot()?.status).toBe('running')
    projection.apply({
      type: 'computer.app-approval.resolved',
      ...identity,
      eventId: 'approval-resolved',
      sequence: 1,
      cursor: 2,
      approval,
      decision: 'cancelled'
    })
    expect(projection.snapshot()?.pendingAppApproval).toEqual([])
    projection.apply({
      type: 'computer.app-approval.requested',
      ...identity,
      eventId: 'historical-request',
      sequence: 2,
      cursor: 3,
      approval
    })
    projection.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'live-snapshot',
      sequence: 2,
      cursor: 3,
      status: 'running',
      messages: [],
      tools: [],
      pendingAppApproval: [],
      error: null
    })
    expect(projection.snapshot()?.pendingAppApproval).toEqual([])
  })
  it('inserts a batch after text restored from a text-only snapshot', () => {
    const restored = task()
    restored.messages[1] = { id: 'assistant-1', role: 'agent', content: '已开始' }
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(restored)
    projection.apply({
      type: 'response.image_batch',
      ...identity,
      eventId: 'batch-after-old-text',
      cursor: 1,
      sequence: 0,
      callId: 'a',
      imageCount: 2,
      contentIndex: 1
    })
    // The restored text predates the order contract, so it stays first and the
    // batch takes the next free order.
    expect(projection.snapshot()?.messages.at(-1)?.parts).toEqual([
      { kind: 'text', text: '已开始' },
      { kind: 'image-batch', callId: 'a', imageCount: 2, order: 1 }
    ])
  })
  it.each(['failed', 'cancelled'] as const)(
    'retains partial part order for a %s image batch',
    (status) => {
      const projection = new StreamTaskProjection({ onChange: vi.fn() })
      projection.attach(task())
      projection.apply({ ...content(0, '过程'), cursor: 1 })
      projection.apply({
        type: 'response.image_batch',
        ...identity,
        eventId: 'batch-partial',
        cursor: 2,
        sequence: 1,
        callId: 'a',
        imageCount: 2,
        contentIndex: 1
      })
      projection.apply({
        type: 'response.end',
        ...identity,
        eventId: `end-${status}`,
        cursor: 3,
        sequence: 2,
        status,
        content: '过程',
        finishReason: null,
        usage: null,
        durationMs: 10,
        error: { code: status, message: status, retryable: false }
      })
      expect(projection.snapshot()?.messages.at(-1)?.parts).toEqual([
        { kind: 'text', text: '过程', order: 1 },
        { kind: 'image-batch', callId: 'a', imageCount: 2, order: 2 }
      ])
    }
  )
  it('anchors the tool group between the prose that preceded and followed it', () => {
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    projection.apply({ ...content(0, '先说明'), cursor: 2, contentIndex: 0 })
    const toolEvent = (sequence: number, type: string) =>
      ({
        type,
        ...identity,
        eventId: `${type}-1`,
        cursor: sequence + 2,
        sequence,
        callId: 'call-shell',
        toolId: 'sandbox.shell.run',
        modelName: 'tools_local_command_shell_run',
        summary: '执行命令',
        argumentsHash: '',
        activityId: 'activity:default',
        callSequence: sequence,
        status: 'completed'
      }) as never
    for (const [sequence, type] of [
      [1, 'tool.proposed'],
      [2, 'tool.running'],
      [3, 'tool.completed']
    ] as const)
      projection.apply(toolEvent(sequence, type))
    projection.apply({ ...content(4, '全部完成'), cursor: 6, contentIndex: 3 })
    const parts = projection.snapshot()?.messages.at(-1)?.parts
    expect(parts?.map((part) => (part.kind === 'text' ? `text:${part.text}` : part.kind))).toEqual([
      'text:先说明',
      'activity',
      'text:全部完成'
    ])
    expect(parts?.filter((part) => part.kind === 'activity')).toHaveLength(1)
  })

  it('leaves the streamed order untouched when a turn with an image completes', () => {
    const asset = {
      assetId: 'asset-real',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    // Same shape as a real "test every tool" turn: narration, batch anchor,
    // image, then the answer that keeps streaming after the image.
    projection.apply({ ...content(0, '好的，我来测试'), cursor: 2, contentIndex: 0 })
    projection.apply({
      type: 'response.image_batch',
      ...identity,
      eventId: 'batch-real',
      cursor: 3,
      sequence: 1,
      callId: 'call-real',
      imageCount: 1,
      contentIndex: 1
    })
    projection.apply({
      type: 'response.image',
      ...identity,
      eventId: 'image-real',
      cursor: 4,
      sequence: 2,
      asset,
      callId: 'call-real',
      index: 0,
      contentIndex: 2
    })
    projection.apply({ ...content(3, '全部完成'), cursor: 5, contentIndex: 3 })
    projection.apply({
      type: 'response.end',
      ...identity,
      eventId: 'end-real',
      cursor: 6,
      sequence: 4,
      status: 'completed',
      content: '好的，我来测试全部完成',
      finishReason: 'stop',
      usage: null,
      durationMs: 10,
      error: null
    })
    expect(
      projection
        .snapshot()
        ?.messages.at(-1)
        ?.parts?.map((part) =>
          part.kind === 'image-batch'
            ? 'batch'
            : part.kind === 'image'
              ? 'image'
              : part.kind === 'text'
                ? `text:${part.text}`
                : part.kind
        )
    ).toEqual(['text:好的，我来测试', 'batch', 'image', 'text:全部完成'])
  })
  it('keeps the streamed text position through replay, late images and completion', () => {
    const image = {
      assetId: 'asset-b',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    const projection = new StreamTaskProjection({ onChange: vi.fn() })
    projection.attach(task())
    const batch = (sequence: number, callId: string, imageCount: number, contentIndex: number) => ({
      type: 'response.image_batch' as const,
      ...identity,
      eventId: `batch-${callId}`,
      cursor: sequence + 1,
      sequence,
      callId,
      imageCount,
      contentIndex
    })
    projection.apply(batch(0, 'a', 2, 0))
    expect(projection.snapshot()?.messages.at(-1)?.parts).toEqual([
      { kind: 'image-batch', callId: 'a', imageCount: 2, order: 1 }
    ])
    projection.apply({ ...content(1, '过程'), cursor: 2, contentIndex: 1 })
    projection.apply(batch(2, 'b', 1, 2))
    projection.apply({
      type: 'response.image',
      ...identity,
      eventId: 'image-b',
      cursor: 4,
      sequence: 3,
      asset: image,
      callId: 'b',
      index: 0,
      contentIndex: 3
    })
    const snapshot = projection.snapshot()!
    projection.apply({
      type: 'response.snapshot',
      ...identity,
      eventId: 'snapshot-batches',
      cursor: 5,
      sequence: 4,
      status: 'running',
      messages: snapshot.messages.map((message) => ({
        ...message,
        role: message.role === 'agent' ? ('assistant' as const) : ('user' as const),
        createdAt: identity.occurredAt
      })),
      tools: [],
      error: null
    })
    projection.apply({
      type: 'response.image',
      ...identity,
      eventId: 'image-a',
      cursor: 6,
      sequence: 5,
      asset: { ...image, assetId: 'asset-a' },
      callId: 'a',
      index: 1,
      contentIndex: 4
    })
    projection.apply({
      type: 'response.end',
      ...identity,
      eventId: 'end-batches',
      cursor: 7,
      sequence: 6,
      status: 'completed',
      content: '完成',
      finishReason: 'stop',
      usage: null,
      durationMs: 10,
      error: null
    })
    expect(
      projection
        .snapshot()
        ?.messages.at(-1)
        ?.parts?.filter((part) => part.kind !== 'image')
    ).toEqual([
      { kind: 'image-batch', callId: 'a', imageCount: 2, order: 1 },
      { kind: 'text', text: '过程', order: 4 },
      { kind: 'image-batch', callId: 'b', imageCount: 1, order: 5 },
      { kind: 'text', text: '完成', order: 7 }
    ])
    projection.apply(batch(0, 'a', 2, 0))
    expect(
      projection
        .snapshot()
        ?.messages.at(-1)
        ?.parts?.filter((part) => part.kind === 'image-batch')
    ).toEqual([
      { kind: 'image-batch', callId: 'a', imageCount: 2, order: 1 },
      { kind: 'image-batch', callId: 'b', imageCount: 1, order: 5 }
    ])
    expect(
      projection
        .snapshot()
        ?.messages.at(-1)
        ?.parts?.filter((part) => part.kind === 'image')
    ).toHaveLength(2)
  })
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
        { kind: 'image', asset: image },
        { kind: 'text', text: '完成' }
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
    expect(projection.snapshot()?.messages.at(-1)?.parts?.[0]).toEqual({
      kind: 'image',
      asset: image
    })
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
      modelName: 'tools_local_command_shell_run'
    })
    expect(projection.snapshot()).toMatchObject({
      preparingToolName: 'tools_local_command_shell_run'
    })
    projection.apply({
      type: 'tool.proposed',
      ...identity,
      eventId: 'proposed-1',
      cursor: 4,
      sequence: 2,
      callId: 'call-1',
      callSequence: 0,
      toolId: 'tools.local.command.shell.run',
      modelName: 'tools_local_command_shell_run',
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
      toolId: 'tools.local.web.search',
      modelName: 'tools_local_web_search',
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
      toolId: 'tools.local.command.shell.run',
      modelName: 'tools_local_command_shell_run',
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
      toolId: 'tools.local.command.shell.run',
      modelName: 'tools_local_command_shell_run',
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
      toolId: 'tools.local.command.shell.run',
      modelName: 'tools_local_command_shell_run',
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
      toolId: 'tools.local.web.search',
      modelName: 'tools_local_web_search',
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
          toolId: 'tools.local.image-generation.generate',
          modelName: 'tools_local_image_generation_generate',
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
          toolId: 'tools.local.command.shell.run',
          modelName: 'tools_local_command_shell_run',
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

  it('never mutates an emitted snapshot and shares what did not change', () => {
    const emitted: TaskProjection[] = []
    const pending: Array<() => void> = []
    const projection = new StreamTaskProjection({
      onChange: (snapshot) => emitted.push(deepFreeze(snapshot)),
      schedule: (callback) => pending.push(callback),
      cancelScheduled: () => pending.splice(0)
    })
    projection.attach(task())
    let sequence = 0
    const next = <T extends object>(event: T) => {
      const numbered = {
        ...identity,
        ...event,
        sequence,
        cursor: sequence + 2,
        eventId: `e-${sequence}`
      }
      sequence += 1
      return numbered as unknown as StreamServerEvent
    }
    const tool = {
      callId: 'call-a',
      callSequence: 0,
      toolId: 'shell',
      modelName: 'shell',
      summary: '工具 A',
      argumentsHash: 'hash',
      activityId: 'research'
    }
    const events = [
      next({ type: 'response.start', model: identityModel }),
      next({ type: 'response.content', delta: '第一段', contentIndex: 0 }),
      next({ type: 'response.content', delta: '继续', contentIndex: 0 }),
      next({ type: 'activity.started', activityId: 'research', title: '调研', titleRevision: 1 }),
      next({ type: 'activity.text', activityId: 'research', textId: 't', delta: '过程' }),
      next({ type: 'activity.text', activityId: 'research', textId: 't', delta: '更多' }),
      next({ type: 'tool.proposed', ...tool }),
      next({
        type: 'tool.completed',
        ...tool,
        callSequence: 1,
        durationMs: 5,
        resultSummary: '完成'
      }),
      next({ type: 'activity.text.done', activityId: 'research', textId: 't', phase: 'process' }),
      next({ type: 'activity.completed', activityId: 'research' }),
      next({ type: 'response.content', delta: '答案', contentIndex: 0 }),
      next({ type: 'response.content', delta: '结束', contentIndex: 0 }),
      next({
        type: 'response.end',
        status: 'completed',
        content: '第一段继续答案结束',
        finishReason: 'stop',
        usage: null,
        durationMs: 10
      })
    ]
    for (const event of events) {
      projection.apply(event)
      pending.splice(0).forEach((callback) => callback())
    }

    const last = emitted.at(-1)!
    expect(last.status).toBe('succeeded')
    expect(last.messages.at(-1)?.content).toBe('第一段继续答案结束')
    expect(last.activities?.[0]?.items.find((item) => item.id === 'text:t')).toMatchObject({
      content: '过程更多',
      phase: 'process'
    })
    const [before, after] = emitted.slice(-3, -1)
    expect(after!.messages[0]).toBe(before!.messages[0])
    expect(after!.steps).toBe(before!.steps)
    expect(after!.activities).toBe(before!.activities)
  })
})

const identityModel = { connectionId: 'connection-1', modelId: 'qwen3.7-max' }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
