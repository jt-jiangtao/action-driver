import { describe, expect, it, vi } from 'vitest'
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
  RUNTIME_TYPES,
  createRuntimeContainer,
  type ModelCallRepository,
  type ModelGateway,
  type ModelRequest,
  type PersistedModelCall,
  type TaskRepository
} from '../src/index'

class MemoryModelCallRepository implements ModelCallRepository {
  readonly records = new Map<string, PersistedModelCall>()

  async save(call: PersistedModelCall): Promise<void> {
    this.records.set(call.id, structuredClone(call))
  }

  async listByTask(taskId: string): Promise<PersistedModelCall[]> {
    return [...this.records.values()].filter((call) => call.taskId === taskId)
  }
}

function completionService(outcome: ModelCompletionOutcome): ModelCompletionServicePort {
  return {
    complete: async () => structuredClone(outcome),
    async *stream() {
      yield* [] as ModelCompletionEvent[]
      throw new Error('stream is not used by this legacy completion fixture')
    }
  }
}

function createGateway(service: ModelCompletionServicePort) {
  const modelCalls = new MemoryModelCallRepository()
  const interactions = new MemoryInteractionLogStore()
  const gateway = new ConnectionModelGateway({
    service,
    modelCalls,
    interactions: createInteractionLogRecorder({
      store: interactions,
      ids: { eventId: () => 'event-1', correlationId: () => 'unused-correlation' },
      clock: () => 1_000
    }),
    callId: () => 'call-1',
    correlationId: () => 'correlation-1',
    now: () => '2026-01-01T00:00:00.000Z'
  })
  return { gateway, modelCalls, interactions }
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
  it('forwards content before provider completion and commits one aggregate call at end', async () => {
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
    const { gateway, modelCalls, interactions } = createGateway(service)
    const iterator = gateway.stream(realRequest)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { kind: 'content', delta: '**real' }
    })
    await expect(modelCalls.listByTask('task-1')).resolves.toEqual([
      expect.objectContaining({ status: 'running', response: null })
    ])

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

    await expect(modelCalls.listByTask('task-1')).resolves.toEqual([
      expect.objectContaining({
        status: 'completed',
        response: {
          content: '**real answer**',
          finishReason: 'stop',
          usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 }
        }
      })
    ])
    expect((await interactions.list({ limit: 20 })).records).toHaveLength(1)
    expect((await interactions.list({ limit: 20 })).records[0]).toMatchObject({
      correlationId: 'correlation-1',
      outcome: 'ok',
      status: 200
    })
  })

  it('persists a streamed tool-call terminal without turning it into assistant text', async () => {
    const stream = vi.fn(async function* (): AsyncIterable<ModelCompletionEvent> {
      yield {
        kind: 'end',
        result: {
          kind: 'tool-calls',
          calls: [
            {
              providerCallId: 'provider-call-1',
              modelName: 'sandbox_fs_read',
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
    const { gateway, modelCalls } = createGateway(service)
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
    await expect(modelCalls.listByTask('task-1')).resolves.toEqual([
      expect.objectContaining({
        status: 'completed',
        request: { model: 'gpt-real', tools: [{ type: 'function' }] },
        response: { toolCalls: [{ id: 'provider-call-1' }] }
      })
    ])
  })

  it('persists and logs a completed real model call with one correlation id', async () => {
    const { gateway, modelCalls, interactions } = createGateway(
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
    await expect(modelCalls.listByTask('task-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'call-1',
        correlationId: 'correlation-1',
        requestId: 'plan:task-1',
        status: 'completed',
        response: { choices: [{ message: { content: 'real answer' } }] }
      })
    ])
    expect((await interactions.list({ limit: 20 })).records[0]).toMatchObject({
      correlationId: 'correlation-1',
      direction: 'service->model',
      taskId: 'task-1',
      requestId: 'plan:task-1',
      status: 200,
      outcome: 'ok'
    })
  })

  it('persists a structured model failure without leaking a credential', async () => {
    const { gateway, modelCalls, interactions } = createGateway(
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
    const serialized = JSON.stringify({
      calls: await modelCalls.listByTask('task-1'),
      detail: await interactions.getDetail('event-1')
    })
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
    const container = createRuntimeContainer({ mode: 'mock' })
    const tasks = container.get<TaskRepository>(RUNTIME_TYPES.taskRepository)
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
