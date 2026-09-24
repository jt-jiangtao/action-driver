import { describe, expect, it, vi } from 'vitest'
import {
  MemoryInteractionLogStore,
  createInteractionLogRecorder
} from '@actiondriver/observability'
import type {
  ToolCall,
  ToolDefinition,
  ToolEvent,
  ToolExecutor
} from '@actiondriver/runtime-contracts'
import {
  RuntimeToolPolicy,
  RuntimeToolRegistry,
  ToolInvocationService,
  type PersistedToolInvocation,
  type RuntimeEventRecord
} from '../src/index'

const readDefinition: ToolDefinition = {
  id: 'local.shell.run',
  version: 1,
  modelName: 'shell_run',
  description: 'Read one workspace file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  risk: 'low',
  sideEffects: { filesystem: 'read', network: false },
  timeoutMs: 1_000
}

const shellDefinition: ToolDefinition = {
  ...readDefinition,
  id: 'sandbox.shell.run',
  modelName: 'sandbox_shell_run',
  risk: 'medium',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } }
    },
    required: ['command', 'args'],
    additionalProperties: false
  }
}

describe('ToolInvocationService', () => {
  it('persists generated asset references as separate tool events', async () => {
    const image = {
      assetId: 'asset-1',
      sessionId: 'session-1',
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: 20,
      source: 'generated' as const
    }
    const executor: ToolExecutor = {
      async *execute() {
        yield { kind: 'asset', index: 0, asset: image }
        yield { kind: 'result', output: { succeeded: 1, failed: 0 } }
      }
    }
    const fixture = createFixture(readDefinition, executor)
    const events = await collect(
      fixture.service.execute(readCall(), context(['local.shell.run@1']))
    )
    expect(events.find((event) => event.type === 'tool.asset')).toMatchObject({
      type: 'tool.asset',
      callId: readCall().callId,
      index: 0,
      asset: image
    })
    expect(JSON.stringify(events)).not.toContain('data:image/')
  })
  it('persists ordered lifecycle/content events and one aggregate interaction log', async () => {
    const executor: ToolExecutor = {
      async *execute() {
        yield { kind: 'content', stream: 'stdout', delta: 'hel' }
        yield { kind: 'content', stream: 'stdout', delta: 'lo' }
        yield { kind: 'result', output: { value: 1 } }
      }
    }
    const fixture = createFixture(readDefinition, executor)
    const events = await collect(
      fixture.service.execute(readCall(), context(['local.shell.run@1']))
    )

    expect(events.map((event) => event.type)).toEqual([
      'tool.proposed',
      'tool.queued',
      'tool.running',
      'tool.content',
      'tool.content',
      'tool.completed'
    ])
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5])
    expect(fixture.commits.map(({ invocation }) => invocation.status)).toEqual([
      'proposed',
      'queued',
      'running',
      'running',
      'running',
      'completed'
    ])
    expect(fixture.commits.at(-1)?.invocation.output).toMatchObject({
      stdout: 'hello',
      result: { value: 1 },
      truncated: false
    })
    const logs = await fixture.interactionStore.list({ limit: 20 })
    expect(logs.records).toHaveLength(1)
    expect(logs.records[0]).toMatchObject({
      operation: 'local.shell.run',
      outcome: 'ok',
      taskId: 'task-1'
    })
    const detail = await fixture.interactionStore.getDetail(logs.records[0]!.id)
    expect(detail?.request?.text).toContain('README.md')
    expect(detail?.response?.text).toContain('hello')
  })

  it('executes a granted shell call without entering approval wait', async () => {
    const execute = vi.fn(async function* () {
      yield { kind: 'result' as const, output: { ok: true } }
    })
    const fixture = createFixture(shellDefinition, { execute })
    const events = await collect(
      fixture.service.execute(shellCall(), context(['sandbox.shell.run@1']))
    )
    expect(events.map((event) => event.type)).toEqual([
      'tool.proposed',
      'tool.queued',
      'tool.running',
      'tool.completed'
    ])
    expect(execute).toHaveBeenCalledOnce()
    expect(fixture.commits.at(-1)?.invocation.decision).toBe('allow')
    expect(fixture.commits.at(-1)?.invocation.argumentsHash).toBe('')
  })

  it('does not invoke denied tools and records a failed terminal', async () => {
    const execute = vi.fn(async function* () {
      yield { kind: 'result' as const, output: null }
    })
    const fixture = createFixture(readDefinition, { execute })
    const events = await collect(fixture.service.execute(readCall(), context([])))
    expect(execute).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({
      type: 'tool.failed',
      error: { code: 'TOOL_DENIED' }
    })
  })

  it('rejects missing required arguments and unknown fields before running an executor', async () => {
    const execute = vi.fn(async function* () {
      yield { kind: 'result' as const, output: null }
    })
    const definition: ToolDefinition = {
      ...readDefinition,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false
      }
    }
    const fixture = createFixture(definition, { execute })
    const invalid = { ...readCall(), arguments: { unexpected: true } }
    const events = await collect(fixture.service.execute(invalid, context(['local.shell.run@1'])))
    expect(execute).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({
      type: 'tool.failed',
      error: { code: 'TOOL_INPUT_INVALID' }
    })
  })

  it('fails on the aggregate output limit and supports timeout and caller cancellation', async () => {
    const oversized = createFixture(
      readDefinition,
      {
        async *execute() {
          yield { kind: 'content', stream: 'stdout', delta: '123456' }
        }
      },
      { maxOutputBytes: 5 }
    )
    expect(
      (await collect(oversized.service.execute(readCall(), context(['local.shell.run@1'])))).at(-1)
    ).toMatchObject({ type: 'tool.failed', error: { code: 'SANDBOX_OUTPUT_LIMIT' } })

    const timed = createFixture({ ...readDefinition, timeoutMs: 5 }, blockingExecutor())
    expect(
      (await collect(timed.service.execute(readCall(), context(['local.shell.run@1'])))).at(-1)
    ).toMatchObject({ type: 'tool.failed', error: { code: 'TOOL_TIMEOUT' } })

    const controller = new AbortController()
    const cancelled = createFixture(readDefinition, blockingExecutor())
    const pending = collect(
      cancelled.service.execute(readCall(), context(['local.shell.run@1']), controller.signal)
    )
    await waitFor(() => cancelled.commits.some(({ invocation }) => invocation.status === 'running'))
    controller.abort()
    expect((await pending).at(-1)).toMatchObject({ type: 'tool.cancelled' })
  })
})

function createFixture(
  definition: ToolDefinition,
  executor: ToolExecutor,
  limits: { maxOutputBytes?: number } = {}
) {
  const registry = new RuntimeToolRegistry()
  registry.register(definition, executor)
  const commits: Array<{
    invocation: PersistedToolInvocation
    event: Omit<RuntimeEventRecord, 'cursor'>
  }> = []
  const interactionStore = new MemoryInteractionLogStore()
  let cursor = 0
  let tick = 0
  const service = new ToolInvocationService({
    registry,
    policy: new RuntimeToolPolicy(),
    persistence: {
      async commitToolInvocationWithEvent(invocation, event) {
        commits.push({ invocation: structuredClone(invocation), event: structuredClone(event) })
        return { ...event, cursor: ++cursor }
      }
    },
    interactions: createInteractionLogRecorder({
      store: interactionStore,
      ids: { eventId: () => 'interaction-1', correlationId: () => 'correlation-1' },
      clock: () => ++tick
    }),
    clock: { now: () => `2026-01-01T00:00:00.${String(++tick).padStart(3, '0')}Z` },
    ...limits
  })
  return { service, commits, interactionStore }
}

function context(grants: string[]) {
  return {
    taskId: 'task-1',
    threadId: 'thread-1',
    checkpointId: 'checkpoint-1',
    requestId: 'request-1',
    grants
  }
}

function readCall(): ToolCall {
  return {
    callId: 'call-1',
    providerCallId: 'provider-1',
    modelName: 'shell_run',
    arguments: { path: 'README.md' }
  }
}

function shellCall(): ToolCall {
  return {
    ...readCall(),
    modelName: 'sandbox_shell_run',
    arguments: { command: 'rg', args: ['needle', 'src'] }
  }
}

function blockingExecutor(): ToolExecutor {
  return {
    async *execute(_call, signal) {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true }
        )
      })
      yield { kind: 'result', output: null }
    }
  }
}

async function collect(events: AsyncIterable<ToolEvent>): Promise<ToolEvent[]> {
  const result: ToolEvent[] = []
  for await (const event of events) result.push(event)
  return result
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for condition')
}
