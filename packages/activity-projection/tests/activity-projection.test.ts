import { describe, expect, it } from 'vitest'
import { emptyActivityTimelineState, reduceActivityProjection } from '../src'
import { STREAM_PROTOCOL, type StreamServerEvent } from '@actiondriver/runtime-contracts'

const base = {
  protocol: STREAM_PROTOCOL,
  requestId: 'request',
  sessionId: 'session',
  taskId: 'task',
  responseId: 'response',
  streamId: 'stream',
  messageId: 'message',
  occurredAt: '2026-09-24T00:00:00.000Z'
} as const

function event(cursor: number, payload: Record<string, unknown>): StreamServerEvent {
  return { ...base, eventId: `event-${cursor}`, cursor, ...payload } as StreamServerEvent
}

function tool(cursor: number, callId: string, type = 'tool.proposed') {
  return event(cursor, {
    type,
    callId,
    callSequence: type === 'tool.proposed' ? 0 : 1,
    toolId: 'shell',
    modelName: 'shell',
    summary: 'Run shell',
    argumentsHash: 'hash',
    activityId: 'activity',
    ...(type === 'tool.completed' ? { durationMs: 1, resultSummary: 'ok' } : {}),
    ...(type === 'tool.failed'
      ? { error: { code: 'failed', message: 'bad', retryable: false } }
      : {})
  })
}

describe('cursor-ordered activity projection', () => {
  it('keeps interleaved text and tools at first-event positions despite reverse completion and duplicates', () => {
    const events = [
      event(1, {
        type: 'activity.started',
        activityId: 'activity',
        title: '正在处理',
        titleRevision: 1
      }),
      event(2, { type: 'activity.text', activityId: 'activity', textId: 'plan:task', delta: 'A' }),
      tool(3, 'call-a'),
      event(4, {
        type: 'activity.text.done',
        activityId: 'activity',
        textId: 'plan:task',
        phase: 'process'
      }),
      event(5, {
        type: 'activity.text',
        activityId: 'activity',
        textId: 'plan:task:1',
        delta: 'B'
      }),
      tool(6, 'call-b'),
      tool(7, 'call-b', 'tool.completed'),
      tool(8, 'call-a', 'tool.failed'),
      event(9, {
        type: 'activity.text.done',
        activityId: 'activity',
        textId: 'plan:task:1',
        phase: 'final'
      })
    ]
    const state = [...events, events[2]!].reduce(
      reduceActivityProjection,
      emptyActivityTimelineState()
    )
    expect(state.cursor).toBe(9)
    expect(state.activities[0]?.items.map((item) => item.id)).toEqual([
      'text:plan:task',
      'tool:call-a',
      'text:plan:task:1',
      'tool:call-b'
    ])
    expect(state.textPhases).toMatchObject({ 'plan:task': 'process', 'plan:task:1': 'final' })
    expect(state.toolActivityIds).toMatchObject({ 'call-a': 'activity', 'call-b': 'activity' })
  })

  it('keeps legacy text without textId using eventId and ignores older title revisions', () => {
    const state = [
      event(1, {
        type: 'activity.started',
        activityId: 'activity',
        title: '初始',
        titleRevision: 1
      }),
      event(2, {
        type: 'activity.updated',
        activityId: 'activity',
        title: '新标题',
        titleRevision: 2
      }),
      event(3, {
        type: 'activity.updated',
        activityId: 'activity',
        title: '旧标题',
        titleRevision: 1
      }),
      event(4, { type: 'activity.text', activityId: 'activity', delta: '旧正文' })
    ].reduce(reduceActivityProjection, emptyActivityTimelineState())
    expect(state.activities[0]?.title).toBe('新标题')
    expect(state.activities[0]?.items).toEqual([
      { id: 'text:event-4', kind: 'text', content: '旧正文', phase: 'pending' }
    ])
  })

  it('does not move a tool when it waits for approval or is cancelled', () => {
    const state = [
      event(1, { type: 'activity.started', activityId: 'activity', title: '执行', titleRevision: 1 }),
      tool(2, 'call-a'),
      tool(3, 'call-a', 'tool.waiting_approval'),
      event(4, { type: 'activity.text', activityId: 'activity', textId: 'plan:next', delta: '下一步' }),
      tool(5, 'call-a', 'tool.cancelled')
    ].reduce(reduceActivityProjection, emptyActivityTimelineState())
    expect(state.activities[0]?.items.map((item) => item.id)).toEqual([
      'tool:call-a', 'text:plan:next'
    ])
  })
})
