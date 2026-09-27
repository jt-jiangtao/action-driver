import { describe, expect, it, vi } from 'vitest'
import { SpanStatusCode, type Tracer } from '@opentelemetry/api'
import type {
  ModelCompletionEvent,
  ModelCompletionOutcome,
  ModelCompletionServicePort
} from '@actiondriver/model-connections'
import {
  MemoryInteractionLogStore,
  createInteractionLogRecorder
} from '@actiondriver/observability'
import {
  ConnectionModelGateway,
  LangGraphRunner,
  MockSkillRegistry,
  createRuntimeServices,
  type ModelGateway,
  type ModelRequest
} from '../src/index'
import { PhoenixModelObservability } from '../src/phoenix-model-observability'

function completionService(outcome: ModelCompletionOutcome): ModelCompletionServicePort {
  return {
    complete: async () => structuredClone(outcome),
    async *stream() {
      yield* [] as ModelCompletionEvent[]
      throw new Error('stream is not used by this legacy completion fixture')
    }
  }
}

function createGateway(
  service: ModelCompletionServicePort,
  traces?: {
    start(input: unknown): Promise<void>
    finish(id: string, result: unknown): Promise<void>
  }
) {
  const interactions = new MemoryInteractionLogStore()
  const gateway = new ConnectionModelGateway({
    service,
    interactions: createInteractionLogRecorder({
      store: interactions,
      ids: { eventId: () => 'event-1', correlationId: () => 'unused-correlation' },
      clock: () => 1_000
    }),
    correlationId: () => 'correlation-1',
    now: () => '2026-01-01T00:00:00.000Z',
    ...(traces ? { traces } : {})
  })
  return { gateway, interactions }
}

const realRequest: ModelRequest = {
  taskId: 'task-1',
  requestId: 'plan:task-1',
  model: { connectionId: 'connection-1', modelId: 'gpt-real' },
  messages: [{ role: 'user', content: 'hello' }],
  skills: [],
  parameters: { temperature: 0 }
}

describe('ModelGateway boundary', () => {
  it('keeps the provider result when tracing start or finish fails', async () => {
    const outcome: ModelCompletionOutcome = {
      ok: true,
      value: {
        content: 'done',
        providerProtocol: 'openai-compatible',
        requestBody: { messages: realRequest.messages },
        responseBody: { content: 'done' },
        status: 200
      }
    }
    for (const failingMethod of ['start', 'finish'] as const) {
      const traces = {
        start: async () => {
          if (failingMethod === 'start') throw new Error('collector down')
        },
        finish: async () => {
          if (failingMethod === 'finish') throw new Error('collector down')
        }
      }
      const { gateway } = createGateway(completionService(outcome), traces)
      await expect(gateway.complete(realRequest)).resolves.toEqual({
        kind: 'finish',
        content: 'done'
      })
    }
  })

  it('finishes a model trace for a streamed model result', async () => {
    const starts: unknown[] = []
    const finishes: unknown[] = []
    const traces = {
      start: async (input: unknown) => {
        starts.push(input)
      },
      finish: async (_id: string, result: unknown) => {
        finishes.push(result)
      }
    }
    const service: ModelCompletionServicePort = {
      complete: async () => {
        throw new Error('unexpected complete')
      },
      async *stream() {
        yield {
          kind: 'end' as const,
          content: 'done',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          requestBody: { messages: realRequest.messages },
          responseBody: { content: 'done' },
          status: 200
        }
      }
    }
    const { gateway } = createGateway(service, traces)
    for await (const event of gateway.stream({ ...realRequest, sessionId: 'session-1' })) {
      expect(event.kind).toBe('end')
    }
    expect(starts[0]).toMatchObject({
      sessionId: 'session-1',
      taskId: 'task-1',
      requestId: 'plan:task-1'
    })
    expect(finishes[0]).toMatchObject({ output: { content: 'done' }, usage: { inputTokens: 1 } })
  })

  it('keeps delivered stream content and closes the Phoenix span when the provider fails', async () => {
    const setStatus = vi.fn()
    const end = vi.fn()
    const tracer = {
      startSpan: () => ({ setAttribute: vi.fn(), setStatus, end })
    } as unknown as Tracer
    const service: ModelCompletionServicePort = {
      complete: async () => {
        throw new Error('unexpected complete')
      },
      async *stream(): AsyncIterable<ModelCompletionEvent> {
        yield { kind: 'content', delta: 'partial answer' }
        throw new Error('upstream disconnected')
      }
    }
    const { gateway } = createGateway(service, new PhoenixModelObservability(tracer))
    const iterator = gateway.stream(realRequest)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'content', delta: 'partial answer' }
    })
    await expect(iterator.next()).rejects.toThrow('upstream disconnected')
    expect(setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'upstream disconnected'
    })
    expect(end).toHaveBeenCalledOnce()
  })

  it('keeps the upstream stream error when trace completion throws', async () => {
    const service: ModelCompletionServicePort = {
      complete: async () => {
        throw new Error('unexpected complete')
      },
      async *stream(): AsyncIterable<ModelCompletionEvent> {
        yield { kind: 'content', delta: 'partial answer' }
        throw new Error('upstream disconnected')
      }
    }
    const { gateway } = createGateway(service, {
      start: async () => {},
      finish: async () => {
        throw new Error('collector disconnected')
      }
    })
    const iterator = gateway.stream(realRequest)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { delta: 'partial answer' } })
    await expect(iterator.next()).rejects.toThrow('upstream disconnected')
  })

  it('finishes model traces for successful and failed nonstream calls', async () => {
    const finishes: unknown[] = []
    const traces = {
      start: async () => {},
      finish: async (_id: string, result: unknown) => {
        finishes.push(result)
      }
    }
    const success = createGateway(
      completionService({
        ok: true,
        value: {
          content: 'done',
          providerProtocol: 'openai-compatible',
          requestBody: { messages: realRequest.messages },
          responseBody: { content: 'done' },
          status: 200
        }
      }),
      traces
    )
    await success.gateway.complete(realRequest)
    expect(finishes[0]).toMatchObject({ output: { content: 'done' } })
    const failure = createGateway(
      completionService({
        ok: false,
        failure: { code: 'unauthorized', message: 'Bearer secret rejected', retryable: false },
        requestBody: { messages: realRequest.messages },
        responseBody: { error: 'rejected', authorization: 'Bearer secret' },
        status: 401
      }),
      traces
    )
    await expect(failure.gateway.complete(realRequest)).rejects.toThrow()
    expect(finishes[1]).toMatchObject({ error: 'Bearer secret rejected' })
  })
  it('forwards content before provider completion and records an interaction at end', async () => {
    let releaseEnd!: () => void
    const endGate = new Promise<void>((resolve) => {
      releaseEnd = resolve
    })
    const service: ModelCompletionServicePort = {
      complete: async () => {
        throw new Error('legacy completion must not be used')
      },
      async *stream(): AsyncIterable<ModelCompletionEvent> {
        yield { kind: 'content', delta: '**real' }
        await endGate
        yield { kind: 'content', delta: ' answer**' }
        yield {
          kind: 'end',
          content: '**real answer**',
          finishReason: 'stop',
          usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          requestBody: { model: 'gpt-real', stream: true },
          responseBody: {
            content: '**real answer**',
            finishReason: 'stop',
            usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 }
          },
          status: 200
        }
      }
    }
    const { gateway, interactions } = createGateway(service)
    const iterator = gateway.stream(realRequest)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'content', delta: '**real' }
    })
    releaseEnd()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'content', delta: ' answer**' }
    })
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { kind: 'end', content: '**real answer**', finishReason: 'stop' }
    })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })

    expect((await interactions.list({ limit: 20 })).records).toHaveLength(1)
    expect((await interactions.list({ limit: 20 })).records[0]).toMatchObject({
      correlationId: 'correlation-1',
      outcome: 'ok',
      status: 200
    })
  })

  it('forwards tool preparation before the terminal without recording partial arguments', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service: ModelCompletionServicePort = {
      complete: async () => {
        throw new Error('unexpected complete')
      },
      async *stream() {
        yield { kind: 'tool-call-preparing' as const, index: 0, modelName: 'tools.local.command.shell.run' }
        await gate
        yield {
          kind: 'end' as const,
          result: {
            kind: 'tool-calls' as const,
            calls: [
              {
                providerCallId: 'call-1',
                modelName: 'tools.local.command.shell.run',
                arguments: { command: 'secret' }
              }
            ]
          },
          content: '',
          finishReason: 'tool_calls',
          usage: null,
          requestBody: { model: 'gpt-real' },
          responseBody: { toolCalls: [] },
          status: 200
        }
      }
    }
    const { gateway, interactions } = createGateway(service)
    const stream = gateway.stream(realRequest)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toEqual({
      kind: 'tool-call-preparing',
      index: 0,
      modelName: 'tools.local.command.shell.run'
    })
    release()
    expect((await stream.next()).value).toMatchObject({ kind: 'end' })
    expect((await interactions.list({ limit: 20 })).records).toHaveLength(1)
  })

  it('forwards a streamed tool-call terminal without turning it into assistant text', async () => {
    const stream = vi.fn(async function* (): AsyncIterable<ModelCompletionEvent> {
      yield {
        kind: 'end',
        result: {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: 'provider-call-1',
              modelName: 'tools.local.command.shell.run',
              arguments: { path: 'README.md' }
            }
          ]
        },
        content: '',
        finishReason: 'tool_calls',
        usage: null,
        requestBody: { model: 'gpt-real', tools: [{ type: 'function' }] },
        responseBody: { toolCalls: [{ id: 'provider-call-1' }] },
        status: 200
      }
    })
    const service: ModelCompletionServicePort = {
      complete: async () => {
        throw new Error('legacy completion must not be used')
      },
      stream
    }
    const { gateway } = createGateway(service)
    const events = []

    for await (const event of gateway.stream({
      ...realRequest,
      tools: []
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'end',
        result: expect.objectContaining({ kind: 'tool-calls' })
      })
    ])
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ tools: [] }), undefined)
  })

  it('logs a completed real model call with one correlation id', async () => {
    const { gateway, interactions } = createGateway(
      completionService({
        ok: true,
        value: {
          content: 'real answer',
          providerProtocol: 'openai-compatible',
          requestBody: { model: 'gpt-real', messages: realRequest.messages },
          responseBody: { choices: [{ message: { content: 'real answer' } }] },
          status: 200
        }
      })
    )

    await expect(gateway.complete(realRequest)).resolves.toEqual({
      kind: 'finish',
      content: 'real answer'
    })
    expect((await interactions.list({ limit: 20 })).records[0]).toMatchObject({
      correlationId: 'correlation-1',
      direction: 'service->model',
      taskId: 'task-1',
      requestId: 'plan:task-1',
      status: 200,
      outcome: 'ok'
    })
  })

  it('logs a structured model failure without leaking a credential', async () => {
    const { gateway, interactions } = createGateway(
      completionService({
        ok: false,
        failure: { code: 'unauthorized', message: 'authentication failed', retryable: false },
        requestBody: { model: 'gpt-real' },
        responseBody: { error: 'authentication failed', apiKey: 'secret-key' },
        status: 401
      })
    )

    await expect(gateway.complete(realRequest)).rejects.toMatchObject({
      code: 'unauthorized',
      retryable: false
    })
    const serialized = JSON.stringify(await interactions.getDetail('event-1'))
    expect(serialized).not.toContain('secret-key')
    expect(serialized).toContain('authentication failed')
  })

  it('receives only the current node context and explicit model parameters', async () => {
    const complete = vi.fn<ModelGateway['complete']>(async () => ({
      kind: 'finish',
      content: 'done'
    }))
    const runner = new LangGraphRunner({ complete }, new MockSkillRegistry())

    await runner.run({
      taskId: 'task-context',
      goal: 'current goal only',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-context',
        requestId: 'plan:task-context',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' },
        messages: [{ role: 'user', content: 'current goal only' }],
        skills: [],
        parameters: { temperature: 0 }
      }),
      expect.anything()
    )
    expect(complete.mock.calls[0]?.[0].tools).toBeUndefined()
  })

  it('places the task main prompt before the user goal in the model request', async () => {
    const complete = vi.fn<ModelGateway['complete']>(async () => ({
      kind: 'finish',
      content: 'done'
    }))
    const runner = new LangGraphRunner({ complete }, new MockSkillRegistry())

    await runner.run({
      taskId: 'task-system-prompt',
      goal: 'Summarize the report',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      systemPrompt: '# Main prompt\n\nKeep answers concise.'
    })

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: '# Main prompt\n\nKeep answers concise.' },
          { role: 'user', content: 'Summarize the report' }
        ]
      }),
      expect.anything()
    )
  })

  it('exposes only the task Skill snapshot to the model', async () => {
    const complete = vi.fn<ModelGateway['complete']>(async () => ({
      kind: 'finish',
      content: 'done'
    }))
    const runner = new LangGraphRunner({ complete }, new MockSkillRegistry())

    await runner.run({
      taskId: 'task-skill-snapshot',
      goal: 'Open the website',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      skills: [{ skillId: 'browser-use', description: '通过浏览器完成任务' }]
    })

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [{ skillId: 'browser-use', description: '通过浏览器完成任务' }]
      }),
      expect.anything()
    )
  })

  it('turns remote failures into diagnostic task state without losing local history', async () => {
    const tasks = createRuntimeServices({ mode: 'mock' }).taskRepository
    const localTask = {
      id: 'task-model-error',
      threadId: 'task-model-error',
      sessionId: 'task-model-error',
      goal: 'saved locally',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      status: 'submitted',
      error: null,
      lastCheckpointId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    await tasks.save(localTask)

    const model: ModelGateway = {
      async complete() {
        throw new Error('upstream unavailable')
      }
    }
    const result = await new LangGraphRunner(model, new MockSkillRegistry()).run({
      taskId: 'task-model-error',
      goal: 'saved locally',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: 'MODEL_GATEWAY_ERROR: upstream unavailable'
    })
    await expect(tasks.get('task-model-error')).resolves.toEqual(localTask)
  })
})
