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
      argumentsHash: 'sha256:abc'
    })
    expect(projection.snapshot()?.tools).toEqual([
      expect.objectContaining({ callId: 'call-1', status: 'waiting_approval' })
    ])
    expect(projection.snapshot()?.messages.at(-1)?.content).toBe('')
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
