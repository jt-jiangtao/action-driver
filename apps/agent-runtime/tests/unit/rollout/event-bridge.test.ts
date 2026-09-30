import { describe, expect, it } from 'vitest'
import type { PersistedStreamRequest } from '../../../src/ports'
import { deriveRolloutEvents } from '../../../src/rollout/event-bridge'
import type { RolloutLine } from '../../../src/rollout/model'

const request: PersistedStreamRequest = {
  requestId: 'request-1',
  idempotencyKey: 'key-1',
  sessionId: 'session-1',
  taskId: 'turn-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'message-1',
  status: 'running',
  lastSequence: -1,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z'
}

const lines: RolloutLine[] = [
  {
    t: 'session_meta',
    seq: 0,
    ts: '2026-09-30T00:00:00.000Z',
    sessionId: 'session-1',
    threadId: 'session-1',
    model: { connectionId: 'conn', modelId: 'model' },
    originator: 'actiondriver-desktop',
    version: '0.1.0'
  },
  {
    t: 'turn_begin',
    seq: 1,
    ts: '2026-09-30T00:00:01.000Z',
    turnId: 'turn-1',
    taskId: 'turn-1',
    goal: '生成图片并压缩'
  },
  {
    t: 'block',
    seq: 2,
    ts: '2026-09-30T00:00:02.000Z',
    turnId: 'turn-1',
    blockId: 'text-1',
    kind: 'text',
    order: 1,
    slots: 1,
    status: 'streaming',
    delta: '先看看',
    phase: 'process'
  },
  {
    t: 'block',
    seq: 3,
    ts: '2026-09-30T00:00:03.000Z',
    turnId: 'turn-1',
    blockId: 'text-1',
    kind: 'text',
    order: 1,
    slots: 1,
    status: 'completed',
    delta: '现有依赖',
    phase: 'process'
  },
  {
    t: 'block',
    seq: 4,
    ts: '2026-09-30T00:00:04.000Z',
    turnId: 'turn-1',
    blockId: 'group-1',
    kind: 'tool_group',
    order: 2,
    slots: 1,
    status: 'pending',
    title: '生成图片',
    titleRevision: 1
  },
  {
    t: 'block',
    seq: 5,
    ts: '2026-09-30T00:00:05.000Z',
    turnId: 'turn-1',
    blockId: 'batch-1',
    kind: 'image_batch',
    order: 3,
    slots: 3,
    status: 'pending',
    callId: 'call-1',
    imageCount: 2
  },
  {
    t: 'tool',
    seq: 6,
    ts: '2026-09-30T00:00:06.000Z',
    turnId: 'turn-1',
    blockId: 'group-1',
    callId: 'call-1',
    itemIndex: 0,
    toolId: 'tools/local/image-generation/generate',
    modelName: 'image_generate',
    status: 'proposed',
    summary: '生成图片'
  },
  {
    t: 'turn_end',
    seq: 7,
    ts: '2026-09-30T00:00:07.000Z',
    turnId: 'turn-1',
    status: 'completed',
    durationMs: 7000,
    content: '完成'
  }
]

describe('rollout event bridge', () => {
  it('derives the same runtime events the stream protocol already speaks', () => {
    const events = deriveRolloutEvents(lines, request)
    expect(events.map((event) => event.type)).toEqual([
      'response.start',
      'response.content',
      'response.content',
      'activity.started',
      'response.image_batch',
      'tool.proposed',
      'response.end'
    ])
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(events.map((event) => event.cursor)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(events.every((event) => event.requestId === 'request-1')).toBe(true)
    // The session record precedes the turn, so its model must land on response.start even though
    // it emits nothing of its own.
    expect(events[0]?.payload).toEqual({ model: { connectionId: 'conn', modelId: 'model' } })
  })

  it('keeps a streamed text block at one content index and carries deltas', () => {
    const [first, second] = deriveRolloutEvents(lines, request).filter(
      (event) => event.type === 'response.content'
    )
    expect(first?.payload).toEqual({ delta: '先看看', contentIndex: 0, order: 1 })
    expect(second?.payload).toEqual({ delta: '现有依赖', contentIndex: 0, order: 1 })
  })

  it('reserves the image batch slots and anchors the tool to its group', () => {
    const events = deriveRolloutEvents(lines, request)
    const batch = events.find((event) => event.type === 'response.image_batch')
    expect(batch?.payload).toEqual({
      callId: 'call-1',
      imageCount: 2,
      contentIndex: 2,
      order: 3
    })
    const tool = events.find((event) => event.type === 'tool.proposed')
    expect(tool?.payload).toMatchObject({
      callId: 'call-1',
      activityId: 'group-1',
      callSequence: 0
    })
  })
})
