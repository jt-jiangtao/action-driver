import { describe, expect, it } from 'vitest'
import {
  STREAM_PROTOCOL,
  parseStreamClientEvent,
  parseStreamServerEvent
} from '../src/stream-protocol'

const occurredAt = '2026-09-23T00:00:00.000Z'

describe('agent stream protocol', () => {
  it('accepts a persisted request acknowledgement with stable identities', () => {
    const accepted = parseStreamServerEvent({
      type: 'request.accepted',
      protocol: STREAM_PROTOCOL,
      eventId: 'event-accepted',
      cursor: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-agent-1',
      occurredAt
    })

    expect(accepted).toMatchObject({
      type: 'request.accepted',
      sessionId: 'session-1',
      taskId: 'task-1',
      messageId: 'message-agent-1'
    })
  })

  it('accepts create, cancel, and resume client commands', () => {
    expect(
      parseStreamClientEvent({
        type: 'request.create',
        protocol: STREAM_PROTOCOL,
        eventId: 'client-create',
        requestId: 'request-1',
        idempotencyKey: 'idempotency-1',
        sessionId: null,
        createdAt: occurredAt,
        payload: {
          input: { role: 'user', content: 'Write a summary' },
          model: { connectionId: 'connection-1', modelId: 'gpt-real' },
          skills: []
        }
      }).type
    ).toBe('request.create')

    expect(
      parseStreamClientEvent({
        type: 'request.create',
        protocol: STREAM_PROTOCOL,
        eventId: 'client-continue',
        requestId: 'request-continue',
        idempotencyKey: 'idempotency-continue',
        sessionId: 'session-1',
        createdAt: occurredAt,
        payload: {
          input: { role: 'user', content: '继续解释' },
          skills: []
        }
      })
    ).toMatchObject({ type: 'request.create', sessionId: 'session-1' })

    expect(
      parseStreamClientEvent({
        type: 'request.cancel',
        protocol: STREAM_PROTOCOL,
        eventId: 'client-cancel',
        requestId: 'request-2',
        taskId: 'task-1',
        responseId: 'response-1',
        createdAt: occurredAt
      }).type
    ).toBe('request.cancel')

    expect(
      parseStreamClientEvent({
        type: 'request.resume',
        protocol: STREAM_PROTOCOL,
        eventId: 'client-resume',
        requestId: 'request-3',
        afterCursor: 12,
        createdAt: occurredAt
      }).type
    ).toBe('request.resume')
  })

  it.each(['tool.approve', 'tool.reject'] as const)(
    'accepts %s with an exact call identity',
    (type) => {
      expect(
        parseStreamClientEvent({
          type,
          protocol: STREAM_PROTOCOL,
          eventId: 'decision-1',
          createdAt: occurredAt,
          requestId: 'request-1',
          taskId: 'task-1',
          callId: 'call-1',
          argumentsHash: 'sha256:abc'
        })
      ).toMatchObject({ type, callId: 'call-1' })
      expect(() =>
        parseStreamClientEvent({
          type,
          protocol: STREAM_PROTOCOL,
          eventId: 'decision-1',
          createdAt: occurredAt,
          requestId: 'request-1',
          taskId: 'task-1',
          callId: 'call-1'
        })
      ).toThrow()
    }
  )

  it('accepts tool events with a cursor independent of response sequence', () => {
    const identity = {
      protocol: STREAM_PROTOCOL,
      eventId: 'event-tool',
      cursor: 4,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      occurredAt
    }
    expect(
      parseStreamServerEvent({
        type: 'tool.waiting_approval',
        ...identity,
        callId: 'call-1',
        callSequence: 1,
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: 'rg TODO README.md',
        argumentsHash: 'sha256:abc',
        activityId: null
      })
    ).toMatchObject({ type: 'tool.waiting_approval', cursor: 4, callSequence: 1 })
  })

  it('accepts bounded raw tool I/O only when the runtime explicitly includes it', () => {
    expect(
      parseStreamServerEvent({
        type: 'tool.completed',
        protocol: STREAM_PROTOCOL,
        eventId: 'event-tool-raw',
        cursor: 5,
        requestId: 'request-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        responseId: 'response-1',
        streamId: 'stream-1',
        messageId: 'message-1',
        occurredAt,
        callId: 'call-raw',
        callSequence: 2,
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: '执行命令',
        argumentsHash: 'sha256:raw',
        activityId: 'activity-research',
        durationMs: 2,
        resultSummary: '工具已完成',
        rawInput: '{"command":"pwd"}',
        rawOutput: '/workspace',
        rawOutputTruncated: false
      })
    ).toMatchObject({ type: 'tool.completed', rawOutput: '/workspace' })
  })

  it('accepts activity title updates with a stable identity and revision', () => {
    const identity = {
      protocol: STREAM_PROTOCOL,
      eventId: 'event-activity',
      cursor: 5,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      occurredAt
    }

    expect(
      parseStreamServerEvent({
        type: 'activity.updated',
        ...identity,
        activityId: 'activity-research',
        title: '已完成 Codex 事件模型调研',
        titleRevision: 2
      })
    ).toMatchObject({
      type: 'activity.updated',
      activityId: 'activity-research',
      titleRevision: 2
    })
  })

  it('accepts ordered activity lifecycle and standalone text events', () => {
    const identity = {
      protocol: STREAM_PROTOCOL,
      eventId: 'event-activity-lifecycle',
      cursor: 6,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      occurredAt
    }

    expect(
      parseStreamServerEvent({
        type: 'activity.started',
        ...identity,
        activityId: 'activity-research',
        title: '正在调研',
        titleRevision: 1
      }).type
    ).toBe('activity.started')
    expect(
      parseStreamServerEvent({
        type: 'activity.text',
        ...identity,
        eventId: 'event-activity-text',
        cursor: 7,
        activityId: null,
        delta: '已确认事件边界。'
      }).type
    ).toBe('activity.text')
    expect(
      parseStreamServerEvent({
        type: 'activity.completed',
        ...identity,
        eventId: 'event-activity-completed',
        cursor: 8,
        activityId: 'activity-research'
      }).type
    ).toBe('activity.completed')
  })

  it('requires a model only when creating a new session', () => {
    const base = {
      type: 'request.create',
      protocol: STREAM_PROTOCOL,
      eventId: 'client-invalid',
      requestId: 'request-invalid',
      idempotencyKey: 'idempotency-invalid',
      createdAt: occurredAt,
      payload: {
        input: { role: 'user', content: 'hello' },
        skills: []
      }
    }

    expect(() => parseStreamClientEvent({ ...base, sessionId: null })).toThrow()
    expect(() =>
      parseStreamClientEvent({
        ...base,
        sessionId: 'session-1',
        payload: {
          ...base.payload,
          model: { connectionId: 'connection-1', modelId: 'gpt-real' }
        }
      })
    ).toThrow()
  })

  it('rejects unknown fields and credential-bearing create payloads', () => {
    const create = {
      type: 'request.create',
      protocol: STREAM_PROTOCOL,
      eventId: 'client-create',
      requestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      sessionId: null,
      createdAt: occurredAt,
      payload: {
        input: { role: 'user', content: 'hello' },
        model: { connectionId: 'connection-1', modelId: 'gpt-real' },
        skills: []
      }
    }

    expect(() => parseStreamClientEvent({ ...create, unexpected: true })).toThrow()
    expect(() =>
      parseStreamClientEvent({ ...create, payload: { ...create.payload, apiKey: 'secret' } })
    ).toThrow()
    expect(() =>
      parseStreamClientEvent({
        ...create,
        payload: { ...create.payload, model: { ...create.payload.model, apiKey: 'secret' } }
      })
    ).toThrow()
  })

  it.each([
    ['blank id', { eventId: '' }],
    ['unsupported protocol', { protocol: 'actiondriver.stream.v2' }],
    ['negative cursor', { cursor: -1 }]
  ])('rejects %s in a server event', (_label, override) => {
    expect(() =>
      parseStreamServerEvent({
        type: 'response.start',
        protocol: STREAM_PROTOCOL,
        eventId: 'event-start',
        cursor: 2,
        requestId: 'request-1',
        sessionId: 'session-1',
        taskId: 'task-1',
        responseId: 'response-1',
        streamId: 'stream-1',
        messageId: 'message-1',
        sequence: 0,
        model: { connectionId: 'connection-1', modelId: 'gpt-real' },
        occurredAt,
        ...override
      })
    ).toThrow()
  })

  it('requires non-negative sequence and terminal full content', () => {
    const identity = {
      protocol: STREAM_PROTOCOL,
      eventId: 'event-end',
      cursor: 4,
      requestId: 'request-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      responseId: 'response-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      occurredAt
    }

    expect(() =>
      parseStreamServerEvent({
        ...identity,
        type: 'response.content',
        sequence: -1,
        delta: 'hello',
        contentIndex: 0
      })
    ).toThrow()

    expect(() =>
      parseStreamServerEvent({
        ...identity,
        type: 'response.end',
        sequence: 2,
        status: 'completed',
        finishReason: 'stop',
        usage: null,
        durationMs: 100,
        error: null
      })
    ).toThrow()
  })
})
