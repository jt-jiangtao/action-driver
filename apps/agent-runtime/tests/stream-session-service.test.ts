import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RequestCreateEvent, StreamServerEvent } from '@actiondriver/runtime-contracts'
import {
  SqliteRuntimeRepositories,
  StreamSessionService,
  openRuntimeDatabase,
  type GraphRunner,
  type IdGenerator
} from '../src/index'

const temporaryDirectories: string[] = []

function createHarness(graphRunner: GraphRunner) {
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
    now: () => new Date(now++).toISOString()
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

describe('StreamSessionService', () => {
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
        ]
      })
    ])

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
