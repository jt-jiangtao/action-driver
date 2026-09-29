import { describe, expect, it } from 'vitest'
import type {
  ResponseContentEvent,
  ResponseEndEvent,
  ResponseStartEvent
} from '../../src/stream-protocol'
import { StreamLifecycleGuard, StreamProtocolError } from '../../src/stream-lifecycle'

const identity = {
  protocol: 'actiondriver.stream.v2' as const,
  cursor: 1,
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'message-1',
  occurredAt: '2026-09-23T00:00:00.000Z'
}

const start = (eventId = 'start-1'): ResponseStartEvent => ({
  ...identity,
  type: 'response.start',
  eventId,
  sequence: 0,
  model: { connectionId: 'connection-1', modelId: 'gpt-real' }
})

const content = (sequence: number, eventId = `content-${sequence}`): ResponseContentEvent => ({
  ...identity,
  type: 'response.content',
  eventId,
  cursor: sequence + 1,
  sequence,
  delta: `chunk-${sequence}`,
  contentIndex: 0
})

const end = (sequence: number, eventId = `end-${sequence}`): ResponseEndEvent => ({
  ...identity,
  type: 'response.end',
  eventId,
  cursor: sequence + 1,
  sequence,
  status: 'completed',
  content: 'complete answer',
  finishReason: 'stop',
  usage: { totalTokens: 8 },
  durationMs: 120,
  error: null
})

describe('StreamLifecycleGuard', () => {
  it('accepts exactly start, zero or more content events, then end', () => {
    const guard = new StreamLifecycleGuard()

    expect(guard.apply(start())).toBe('applied')
    expect(guard.apply(content(1))).toBe('applied')
    expect(guard.apply(content(2))).toBe('applied')
    expect(guard.apply(end(3))).toBe('applied')
  })

  it('accepts a response with no content before end', () => {
    const guard = new StreamLifecycleGuard()
    expect(guard.apply(start())).toBe('applied')
    expect(guard.apply(end(1))).toBe('applied')
  })

  it('deduplicates an already applied event before checking sequence', () => {
    const guard = new StreamLifecycleGuard()
    const first = start()

    expect(guard.apply(first)).toBe('applied')
    expect(guard.apply(first)).toBe('duplicate')
  })

  it('rejects content before start', () => {
    const guard = new StreamLifecycleGuard()
    expect(() => guard.apply(content(1))).toThrowError(
      expect.objectContaining({ code: 'CONTENT_BEFORE_START' })
    )
  })

  it('allows unrelated request events between response events', () => {
    const guard = new StreamLifecycleGuard()
    guard.apply(start())
    expect(guard.apply(content(2))).toBe('applied')
  })

  it('rejects a second start and every event after end', () => {
    const guard = new StreamLifecycleGuard()
    guard.apply(start())
    expect(() => guard.apply(start('start-2'))).toThrowError(StreamProtocolError)
    guard.apply(end(1))
    expect(() => guard.apply(content(2))).toThrowError(
      expect.objectContaining({ code: 'EVENT_AFTER_END' })
    )
    expect(() => guard.apply(end(2, 'end-2'))).toThrowError(
      expect.objectContaining({ code: 'EVENT_AFTER_END' })
    )
  })
})
