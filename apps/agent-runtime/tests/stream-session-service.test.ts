import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RequestCreateEvent,
  StreamServerEvent,
  ToolApprovalCommand
} from '@actiondriver/runtime-contracts'
import { STREAM_PROTOCOL } from '@actiondriver/runtime-contracts'
import {
  SqliteRuntimeRepositories,
  StreamSessionService,
  openRuntimeDatabase,
  type GraphRunner,
  type IdGenerator
} from '../src/index'

const temporaryDirectories: string[] = []

function createHarness(
  graphRunner: GraphRunner,
  approvals?: {
    approve(command: ToolApprovalCommand): Promise<void>
    reject(command: ToolApprovalCommand): Promise<void>
  },
  rawToolIO?: { enabled: boolean; maxBytes?: number }
) {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-stream-session-'))
  temporaryDirectories.push(directory)
  const database = openRuntimeDatabase(join(directory, 'actiondriver.db'))
  const repositories = new SqliteRuntimeRepositories(database)
  const counters = new Map<string, number>()
  const ids: IdGenerator = {
    next(prefix) {
      const next = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, next)
      return `${prefix}-${next}`
    }
  }
  let now = Date.parse('2026-09-23T00:00:00.000Z')
  const service = new StreamSessionService({
    repositories,
    graphRunner,
    ids,
    now: () => new Date(now++).toISOString(),
    ...(approvals ? { approvals } : {}),
    ...(rawToolIO ? { rawToolIO } : {})
  })
  return { database, repositories, service }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const createEvent: RequestCreateEvent = {
  type: 'request.create',
  protocol: 'actiondriver.stream.v1',
  eventId: 'client-event-1',
  createdAt: '2026-09-23T00:00:00.000Z',
  requestId: 'request-client-1',
  idempotencyKey: 'idempotency-1',
  sessionId: null,
  payload: {
    input: { role: 'user', content: 'Return **real Markdown**' },
    model: { connectionId: 'connection-real', modelId: 'gpt-real' },
    systemPrompt: 'Be concise.',
    skills: []
  }
}

async function runToEnd(
  service: StreamSessionService,
  event: RequestCreateEvent
): Promise<StreamServerEvent[]> {
  const published: StreamServerEvent[] = []
  await new Promise<void>((resolve) => {
    void service.handle(event, (serverEvent) => {
      published.push(serverEvent)
      if (serverEvent.type === 'response.end' || serverEvent.type === 'request.error') resolve()
    })
  })
  return published
}

describe('StreamSessionService', () => {
  it('publishes and replays an ordered activity lifecycle with title revisions', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({
          kind: 'activity',
          event: {
            type: 'started',
            activityId: 'activity-research',
            title: '正在调研',
            titleRevision: 1
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text',
            activityId: 'activity-research',
            textId: 'plan:research',
            delta: '已读取 README。'
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text',
            activityId: 'activity-research',
            textId: 'plan:research',
            delta: '正在核对配置。'
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'text.done',
            activityId: 'activity-research',
            textId: 'plan:research',
            phase: 'process'
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: {
            type: 'updated',
            activityId: 'activity-research',
            title: '已完成调研',
            titleRevision: 2
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: { type: 'completed', activityId: 'activity-research' }
        } as never)
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published = await runToEnd(service, createEvent)
    const accepted = published[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const started = published[1]
    if (started?.type !== 'response.start') throw new Error('expected response.start')

    expect(published.map((event) => event.type)).toEqual([
      'request.accepted',
      'response.start',
      'activity.started',
      'activity.text',
      'activity.text',
      'activity.text.done',
      'activity.updated',
      'activity.completed',
      'response.end'
    ])
    expect(published[3]).toMatchObject({
      type: 'activity.text',
      activityId: 'activity-research',
      textId: 'plan:research',
      delta: '已读取 README。'
    })
    expect(published[4]).toMatchObject({
      type: 'activity.text',
      activityId: 'activity-research',
      textId: 'plan:research',
      delta: '正在核对配置。'
    })
    expect(published[5]).toMatchObject({
      type: 'activity.text.done',
      activityId: 'activity-research',
      textId: 'plan:research',
      phase: 'process'
    })
    expect(published[6]).toMatchObject({
      type: 'activity.updated',
      activityId: 'activity-research',
      title: '已完成调研',
      titleRevision: 2
    })

    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'resume-activity',
        createdAt: '2026-09-23T00:00:10.000Z',
        requestId: accepted.requestId,
        afterCursor: started.cursor
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed.map((event) => event.type)).toEqual([
      'activity.started',
      'activity.text',
      'activity.text',
      'activity.text.done',
      'activity.updated',
      'activity.completed',
      'response.end'
    ])

    repositories.close()
  })

  it('publishes future events to a resumed connection instead of a closed emitter', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await gate
        await observer?.({ kind: 'content', delta: 'after reconnect' })
        await observer?.({
          kind: 'end',
          content: 'after reconnect',
          finishReason: 'stop',
          usage: null
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'after reconnect',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const oldEvents: StreamServerEvent[] = []
    let started!: () => void
    const startSeen = new Promise<void>((resolve) => {
      started = resolve
    })
    await service.handle(createEvent, (event) => {
      oldEvents.push(event)
      if (event.type === 'response.start') started()
    })
    await startSeen
    const start = oldEvents.find((event) => event.type === 'response.start')
    if (!start || start.type !== 'response.start') throw new Error('missing start')
    const resumedEvents: StreamServerEvent[] = []
    let ended!: () => void
    const endSeen = new Promise<void>((resolve) => {
      ended = resolve
    })
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'resume-new-socket',
        createdAt: '2026-09-23T00:00:00.000Z',
        requestId: start.requestId,
        afterCursor: start.cursor
      },
      (event) => {
        resumedEvents.push(event)
        if (event.type === 'response.end') ended()
      }
    )
    release()
    await endSeen
    expect(resumedEvents.map((event) => event.type)).toEqual(['response.content', 'response.end'])
    expect(oldEvents.map((event) => event.type)).toEqual(['request.accepted', 'response.start'])
    await service.close()
    repositories.close()
  })
  it('validates approval identity, delegates the decision, and replays persisted tool status', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await gate
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const approvals = {
      approve: vi.fn(async () => undefined),
      reject: vi.fn(async () => undefined)
    }
    const { repositories, service } = createHarness(graphRunner, approvals)
    const published: StreamServerEvent[] = []
    await service.handle(createEvent, (event) => {
      published.push(event)
    })
    const accepted = published.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing accepted')
    await service.handle(
      {
        type: 'tool.approve',
        protocol: 'actiondriver.stream.v1',
        eventId: 'decision-1',
        createdAt: '2026-09-23T00:00:00.000Z',
        requestId: accepted.requestId,
        taskId: 'wrong-task',
        callId: 'call-1',
        argumentsHash: 'sha256:abc'
      },
      (event) => {
        published.push(event)
      }
    )
    expect(published.at(-1)).toMatchObject({
      type: 'request.error',
      error: { code: 'tool-approval-stale' }
    })
    expect(approvals.approve).not.toHaveBeenCalled()

    await service.handle(
      {
        type: 'tool.approve',
        protocol: 'actiondriver.stream.v1',
        eventId: 'decision-2',
        createdAt: '2026-09-23T00:00:00.000Z',
        requestId: accepted.requestId,
        taskId: accepted.taskId,
        callId: 'call-1',
        argumentsHash: 'sha256:abc'
      },
      (event) => {
        published.push(event)
      }
    )
    expect(approvals.approve).toHaveBeenCalledWith({
      action: 'approve',
      taskId: accepted.taskId,
      callId: 'call-1',
      argumentsHash: 'sha256:abc'
    })

    await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-1.1',
      type: 'tool.waiting_approval',
      payload: {
        callId: 'call-1',
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: 'rg TODO README.md',
        argumentsHash: 'sha256:abc'
      },
      occurredAt: '2026-09-23T00:00:01.000Z',
      eventId: 'tool-event-1',
      requestId: accepted.requestId,
      sequence: 1
    })
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'resume-1',
        createdAt: '2026-09-23T00:00:02.000Z',
        requestId: accepted.requestId,
        afterCursor: accepted.cursor
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'tool.waiting_approval',
        callId: 'call-1',
        callSequence: 1
      })
    )
    release()
    await service.close()
    repositories.close()
  })
  it('creates a new task in the same session and inherits model with complete history', async () => {
    const requests: Parameters<GraphRunner['run']>[0][] = []
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        requests.push(request)
        const answer = requests.length === 1 ? '第一答' : '第二答'
        await observer?.({ kind: 'end', content: answer, finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: answer,
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const first = await runToEnd(service, {
      ...createEvent,
      payload: { ...createEvent.payload, input: { role: 'user', content: '第一问' } }
    })
    const acceptedFirst = first.find((event) => event.type === 'request.accepted')
    if (!acceptedFirst || acceptedFirst.type !== 'request.accepted')
      throw new Error('missing first')

    const continuation: RequestCreateEvent = {
      type: 'request.create',
      protocol: 'actiondriver.stream.v1',
      eventId: 'client-event-2',
      createdAt: '2026-09-23T00:01:00.000Z',
      requestId: 'request-client-2',
      idempotencyKey: 'idempotency-2',
      sessionId: acceptedFirst.sessionId,
      payload: { input: { role: 'user', content: '第二问' }, skills: [] }
    }
    const second = await runToEnd(service, continuation)
    const acceptedSecond = second.find((event) => event.type === 'request.accepted')
    if (!acceptedSecond || acceptedSecond.type !== 'request.accepted') {
      throw new Error('missing second')
    }

    expect(acceptedSecond.sessionId).toBe(acceptedFirst.sessionId)
    expect(acceptedSecond.taskId).not.toBe(acceptedFirst.taskId)
    expect(requests[1]).toMatchObject({
      goal: '第二问',
      model: createEvent.payload.model,
      messages: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '第一答' }
      ]
    })
    await expect(repositories.tasks.listBySession(acceptedFirst.sessionId)).resolves.toHaveLength(2)

    const replay = await runToEnd(service, { ...continuation, eventId: 'client-event-retry' })
    expect(replay[0]).toMatchObject({ type: 'request.accepted', taskId: acceptedSecond.taskId })
    expect(requests).toHaveLength(2)
    repositories.close()
  })

  it('rejects unknown or busy sessions before writing a task', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, signal, observer) {
        await Promise.race([
          gate,
          new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
        ])
        await observer?.({ kind: 'end', content: 'done', finishReason: 'stop', usage: null })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: signal?.aborted ? 'interrupted' : 'completed',
          output: 'done',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const unknown = await runToEnd(service, {
      ...createEvent,
      requestId: 'unknown-request',
      idempotencyKey: 'unknown-idempotency',
      sessionId: 'missing-session',
      payload: { input: { role: 'user', content: '继续' }, skills: [] }
    })
    expect(unknown).toEqual([
      expect.objectContaining({
        type: 'request.error',
        error: expect.objectContaining({ code: 'session-not-found' })
      })
    ])
    await expect(repositories.tasks.listRecent(20)).resolves.toHaveLength(0)

    const initialEvents: StreamServerEvent[] = []
    await service.handle(createEvent, (event) => {
      initialEvents.push(event)
    })
    const accepted = initialEvents.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') throw new Error('missing accepted')
    const busy = await runToEnd(service, {
      ...createEvent,
      eventId: 'busy-event',
      requestId: 'busy-request',
      idempotencyKey: 'busy-idempotency',
      sessionId: accepted.sessionId,
      payload: { input: { role: 'user', content: '不要并发' }, skills: [] }
    })
    expect(busy).toEqual([
      expect.objectContaining({
        type: 'request.error',
        error: expect.objectContaining({ code: 'session-busy' })
      })
    ])
    await expect(repositories.tasks.listBySession(accepted.sessionId)).resolves.toHaveLength(1)
    release()
    await service.close()
    repositories.close()
  })

  it('persists accepted/start/content/end before publishing and never re-executes an idempotent request', async () => {
    let graphRuns = 0
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        graphRuns += 1
        await observer?.({ kind: 'content', delta: '**real' })
        await observer?.({ kind: 'content', delta: ' answer**' })
        await observer?.({
          kind: 'end',
          content: '**real answer**',
          finishReason: 'stop',
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 }
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '**real answer**',
          error: null,
          trace: ['acceptGoal', 'plan', 'finish']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    const emit = (event: StreamServerEvent) => {
      published.push(event)
      if (event.type === 'response.end') resolveEnd()
    }

    await service.handle(createEvent, emit)
    await ended

    expect(published.map((event) => event.type)).toEqual([
      'request.accepted',
      'response.start',
      'response.content',
      'response.content',
      'response.end'
    ])
    expect(published.slice(1).map((event) => 'sequence' in event && event.sequence)).toEqual([
      0, 1, 2, 3
    ])
    const accepted = published[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    expect(accepted).toMatchObject({
      type: 'request.accepted',
      requestId: 'request-client-1'
    })
    await expect(repositories.tasks.get(accepted.taskId)).resolves.toMatchObject({
      status: 'completed',
      goal: 'Return **real Markdown**'
    })
    await expect(repositories.messages.listByTask(accepted.taskId)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: { text: 'Return **real Markdown**' } }),
      expect.objectContaining({ role: 'assistant', content: { text: '**real answer**' } })
    ])
    await expect(
      repositories.streamRequests.getByRequestId('request-client-1')
    ).resolves.toMatchObject({ status: 'completed', lastSequence: 3 })

    const replayed: StreamServerEvent[] = []
    await service.handle(
      { ...createEvent, eventId: 'client-event-duplicate', requestId: 'request-duplicate' },
      (event) => {
        replayed.push(event)
      }
    )
    expect(graphRuns).toBe(1)
    expect(replayed.map((event) => event.type)).toEqual([
      'request.accepted',
      'response.start',
      'response.content',
      'response.content',
      'response.end'
    ])

    repositories.close()
  })

  it('aborts an active request and preserves partial assistant content in a cancelled end event', async () => {
    let contentPublished!: () => void
    const sawContent = new Promise<void>((resolve) => {
      contentPublished = resolve
    })
    const graphRunner: GraphRunner = {
      async run(request, signal, observer) {
        await observer?.({ kind: 'content', delta: 'partial answer' })
        contentPublished()
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'interrupted',
          output: null,
          error: null,
          trace: ['acceptGoal', 'plan']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const published: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      published.push(event)
      if (event.type === 'response.end') resolveEnd()
    })
    await sawContent
    const accepted = published.find((event) => event.type === 'request.accepted')
    if (!accepted || accepted.type !== 'request.accepted') {
      throw new Error('expected request.accepted')
    }

    await service.handle(
      {
        type: 'request.cancel',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-event-cancel',
        createdAt: '2026-09-23T00:00:01.000Z',
        requestId: accepted.requestId,
        taskId: accepted.taskId,
        responseId: accepted.responseId
      },
      (event) => {
        published.push(event)
      }
    )
    await ended

    expect(published.at(-1)).toMatchObject({
      type: 'response.end',
      status: 'cancelled',
      content: 'partial answer',
      error: { code: 'cancelled' }
    })
    await expect(repositories.tasks.get(accepted.taskId)).resolves.toMatchObject({
      status: 'cancelled'
    })
    await expect(repositories.messages.listByTask(accepted.taskId)).resolves.toContainEqual(
      expect.objectContaining({ role: 'assistant', content: { text: 'partial answer' } })
    )

    repositories.close()
  })

  it('returns one authoritative snapshot when the requested replay cursor has expired', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({
          kind: 'activity',
          event: {
            type: 'started',
            activityId: 'activity-snapshot',
            title: '正在读取文件',
            titleRevision: 1
          }
        } as never)
        await observer?.({
          kind: 'activity',
          event: { type: 'text', activityId: 'activity-snapshot', delta: '已准备读取。' }
        } as never)
        await observer?.({
          kind: 'activity',
          event: { type: 'completed', activityId: 'activity-snapshot' }
        } as never)
        await observer?.({ kind: 'content', delta: 'final answer' })
        await observer?.({
          kind: 'end',
          content: 'final answer',
          finishReason: 'stop',
          usage: null
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: 'final answer',
          error: null,
          trace: ['acceptGoal', 'plan', 'finish']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { database, repositories, service } = createHarness(graphRunner)
    const initial: StreamServerEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      initial.push(event)
      if (event.type === 'response.end') resolveEnd()
    })
    await ended
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    await repositories.toolInvocations.save({
      id: 'call-snapshot',
      providerCallId: 'provider-snapshot',
      taskId: accepted.taskId,
      toolId: 'sandbox.fs.read',
      toolVersion: 1,
      argumentsHash: '',
      decision: 'allow',
      status: 'completed',
      input: { path: 'README.md' },
      output: { text: 'read' },
      error: null,
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:01.000Z'
    })
    database.prepare('DELETE FROM runtime_events WHERE cursor <= 2').run()

    const resumed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-event-resume',
        createdAt: '2026-09-23T00:01:00.000Z',
        requestId: accepted.requestId,
        afterCursor: 0
      },
      (event) => {
        resumed.push(event)
      }
    )

    expect(resumed).toEqual([
      expect.objectContaining({
        type: 'response.snapshot',
        requestId: accepted.requestId,
        status: 'completed',
        sequence: 2,
        messages: [
          expect.objectContaining({ role: 'user', content: 'Return **real Markdown**' }),
          expect.objectContaining({ role: 'assistant', content: 'final answer' })
        ],
        tools: [expect.objectContaining({ callId: 'call-snapshot', status: 'completed' })],
        activities: [
          expect.objectContaining({
            activityId: 'activity-snapshot',
            title: '正在读取文件',
            status: 'completed'
          })
        ],
        activityTimeline: [
          { id: 'activity:activity-snapshot', kind: 'activity', activityId: 'activity-snapshot' }
        ]
      })
    ])

    repositories.close()
  })

  it('projects terminal tool activity without streaming raw output or error details', async () => {
    const graphRunner: GraphRunner = {
      async run(request) {
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    const initial = await runToEnd(service, createEvent)
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const record = await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-safe.2',
      type: 'tool.completed',
      payload: {
        callId: 'call-safe',
        toolId: 'web.search@1',
        modelName: 'web_search',
        summary: '搜索 “privacy news”',
        argumentsHash: '',
        output: {
          stdout: 'secret stdout',
          stderr: 'secret stderr',
          content: '',
          result: { results: [{ title: 'Safe result title' }], token: 'secret' },
          byteLength: 1,
          truncated: false
        }
      },
      occurredAt: '2026-09-23T00:00:03.000Z',
      eventId: 'tool-safe',
      requestId: accepted.requestId,
      sequence: 2
    })
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'resume-safe',
        createdAt: '2026-09-23T00:00:04.000Z',
        requestId: accepted.requestId,
        afterCursor: record.cursor - 1
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        resultSummary: 'Safe result title',
        durationMs: 0
      })
    )
    expect(JSON.stringify(replayed)).not.toContain('secret stdout')
    expect(JSON.stringify(replayed)).not.toContain('secret')
    repositories.close()
  })

  it('exposes bounded raw tool I/O when the local runtime enables it', async () => {
    const graphRunner: GraphRunner = {
      async run(request) {
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'completed',
          output: '',
          error: null,
          trace: []
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner, undefined, {
      enabled: true,
      maxBytes: 12
    })
    const initial = await runToEnd(service, createEvent)
    const accepted = initial[0]
    if (accepted?.type !== 'request.accepted') throw new Error('expected request.accepted')
    const record = await repositories.events.append({
      taskId: accepted.taskId,
      threadId: accepted.sessionId,
      checkpointId: accepted.responseId,
      eventKey: 'call-raw.1',
      type: 'tool.completed',
      payload: {
        callId: 'call-raw',
        toolId: 'sandbox.shell.run',
        modelName: 'sandbox_shell_run',
        summary: '执行命令',
        argumentsHash: '',
        input: { command: 'printf long-output' },
        output: 'this output is deliberately long',
        durationMs: 1
      },
      occurredAt: '2026-09-23T00:00:03.000Z',
      eventId: 'tool-raw',
      requestId: accepted.requestId,
      sequence: 1
    })
    const replayed: StreamServerEvent[] = []
    await service.handle(
      {
        type: 'request.resume',
        protocol: STREAM_PROTOCOL,
        eventId: 'resume-raw',
        createdAt: '2026-09-23T00:00:04.000Z',
        requestId: accepted.requestId,
        afterCursor: record.cursor - 1
      },
      (event) => {
        replayed.push(event)
      }
    )
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'tool.completed',
        rawInput: expect.any(String),
        rawOutput: expect.any(String),
        rawOutputTruncated: true
      })
    )
    const raw = replayed.find((event) => event.type === 'tool.completed')
    if (raw?.type !== 'tool.completed') throw new Error('expected raw tool event')
    expect(Buffer.byteLength(raw.rawInput ?? '', 'utf8')).toBeLessThanOrEqual(12)
    expect(Buffer.byteLength(raw.rawOutput ?? '', 'utf8')).toBeLessThanOrEqual(12)
    repositories.close()
  })

  it('ends as failed while retaining content emitted before a model failure', async () => {
    const graphRunner: GraphRunner = {
      async run(request, _signal, observer) {
        await observer?.({ kind: 'content', delta: 'useful partial' })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'failed',
          output: null,
          error: 'MODEL_GATEWAY_ERROR: upstream disconnected',
          trace: ['acceptGoal', 'plan', 'failed']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    let terminal: StreamServerEvent | undefined
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    await service.handle(createEvent, (event) => {
      if (event.type === 'response.end') {
        terminal = event
        resolveEnd()
      }
    })
    await ended

    expect(terminal).toMatchObject({
      type: 'response.end',
      status: 'failed',
      content: 'useful partial',
      error: {
        code: 'model-execution-failed',
        message: 'MODEL_GATEWAY_ERROR: upstream disconnected'
      }
    })
    repositories.close()
  })

  it('aborts active model work before service shutdown resolves', async () => {
    let started!: () => void
    const active = new Promise<void>((resolve) => {
      started = resolve
    })
    let aborted = false
    const graphRunner: GraphRunner = {
      async run(request, signal) {
        started()
        await new Promise<void>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve()
            },
            { once: true }
          )
        })
        return {
          taskId: request.taskId,
          threadId: request.taskId,
          status: 'interrupted',
          output: null,
          error: null,
          trace: ['acceptGoal', 'plan']
        }
      },
      interrupt: () => false,
      async continue() {
        throw new Error('not used')
      },
      async provideInput() {
        throw new Error('not used')
      }
    }
    const { repositories, service } = createHarness(graphRunner)
    await service.handle(createEvent, () => undefined)
    await active

    await service.close()

    expect(aborted).toBe(true)
    await expect(
      repositories.streamRequests.getByRequestId(createEvent.requestId)
    ).resolves.toMatchObject({ status: 'cancelled' })
    repositories.close()
  })
})
