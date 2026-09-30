import { describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryInteractionLogStore,
  createInteractionLogRecorder
} from '@action-driver/observability'
import type {
  ToolCall,
  ToolDefinition,
  ToolEvent,
  ToolExecutor
} from '@action-driver/runtime-contracts'
import {
  COMPUTER_USE_GUIDANCE_ERRORS,
  RuntimeToolPolicy,
  RuntimeToolRegistry,
  ToolInvocationService,
  type PersistedToolInvocation,
  type RuntimeEventRecord
} from '../../src/index'
import { createWorkspaceDependenciesTool } from '../../src/execution/workspace-dependencies-tool'

const readDefinition: ToolDefinition = {
  id: 'tools/local/command/shell/run',
  version: 1,
  modelName: 'tools_local_command_shell_run',
  description: 'Read one workspace file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  risk: 'low',
  sideEffects: { filesystem: 'read', network: false },
  timeoutMs: 1_000
}

const shellDefinition: ToolDefinition = {
  ...readDefinition,
  id: 'sandbox/shell/run',
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
  it('keeps the latest collected result after output streaming then a generic failure', async () => {
    const fixture = createFixture(readDefinition, { async *execute() {
      yield { kind: 'content' as const, stream: 'stdout' as const, delta: 'partial' }
      yield { kind: 'result' as const, output: { status: 'latest' } }
      throw new Error('late failure')
    } })
    await collect(fixture.service.execute(readCall(), context([`${readDefinition.id}@1`])))
    expect(fixture.commits.at(-1)?.invocation.output).toMatchObject({ stdout: 'partial', result: { status: 'latest' } })
    expect(fixture.commits.at(-1)?.event.payload).toMatchObject({ output: { stdout: 'partial', result: { status: 'latest' } } })
  })

  it('persists the presentation snapshot and safe partial output on failure', async () => {
    const presentation = { input: [{ label: 'Path', path: 'path', kind: 'text' as const }], output: [{ label: 'Output', path: 'stdout', kind: 'code' as const }] }
    const fixture = createFixture({ ...readDefinition, presentation }, { async *execute() { yield { kind: 'content' as const, stream: 'stdout' as const, delta: 'partial' }; throw new Error('failure') } })
    await collect(fixture.service.execute(readCall(), context([`${readDefinition.id}@1`])))
    expect(fixture.commits.at(-1)?.event.payload).toMatchObject({ presentation, output: { stdout: 'partial' } })
  })

  it('runs the read-only office dependency tool through the normal lifecycle and reports missing bundles', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'action-driver-dependency-tool-'))
    const tool = createWorkspaceDependenciesTool(dist)
    expect(tool.definition).toMatchObject({
      modelName: 'tools_local_command_dependencies_load',
      risk: 'low',
      sideEffects: { filesystem: 'read', network: false }
    })
    const registry = new RuntimeToolRegistry()
    registry.register(tool.definition, tool.executor)
    expect(JSON.stringify(registry.list())).toContain('tools_local_command_dependencies_load')
    const call = { ...readCall(), modelName: 'tools_local_command_dependencies_load', arguments: {} }
    const missing = createFixture(tool.definition, tool.executor)
    const failed = await collect(
      missing.service.execute(call, context([`${tool.definition.id}@1`]))
    )
    expect(failed.map((event) => event.type)).toEqual([
      'tool.proposed',
      'tool.queued',
      'tool.running',
      'tool.failed'
    ])
    expect(failed.at(-1)).toMatchObject({ error: { code: 'TOOL_UNAVAILABLE' } })

    for (const relative of [
      'dependencies/node/bin/node',
      'dependencies/python/bin/python3',
      'dependencies/bin/override/soffice',
      'dependencies/bin/override/pdftoppm'
    ]) {
      const path = join(dist, relative)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, '#!/bin/sh\n')
      await chmod(path, 0o755)
    }
    await mkdir(join(dist, 'dependencies/node/node_modules'))
    const available = createFixture(tool.definition, tool.executor)
    const events = await collect(
      available.service.execute(call, context([`${tool.definition.id}@1`]))
    )
    expect(events.map((event) => event.type)).toEqual([
      'tool.proposed',
      'tool.queued',
      'tool.running',
      'tool.completed'
    ])
    expect(JSON.stringify(events.at(-1))).toContain(join(dist, 'dependencies/python/bin/python3'))
  })

  it('publishes a safe image count when image generation begins', async () => {
    const definition: ToolDefinition = {
      ...readDefinition,
      id: 'tools/local/image-generation/generate',
      modelName: 'tools_local_image_generation_generate',
      inputSchema: {
        type: 'object',
        properties: {
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt']
            }
          }
        },
        required: ['images']
      }
    }
    const fixture = createFixture(definition, {
      async *execute() {
        yield { kind: 'result', output: {} }
      }
    })
    await collect(
      fixture.service.execute(
        {
          ...readCall(),
          modelName: 'tools_local_image_generation_generate',
          arguments: {
            images: Array.from({ length: 16 }, (_, index) => ({ prompt: `image ${index}` }))
          }
        },
        context(['tools/local/image-generation/generate@1'])
      )
    )
    const running = fixture.commits.find(({ event }) => event.type === 'tool.running')?.event
    expect(running?.payload).toMatchObject({ imageCount: 16 })
  })
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
      fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']))
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
      fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']))
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
      operation: 'tools/local/command/shell/run',
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
      fixture.service.execute(shellCall(), context(['sandbox/shell/run@1']))
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
    const events = await collect(fixture.service.execute(invalid, context(['tools/local/command/shell/run@1'])))
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
      (await collect(oversized.service.execute(readCall(), context(['tools/local/command/shell/run@1'])))).at(-1)
    ).toMatchObject({ type: 'tool.failed', error: { code: 'SANDBOX_OUTPUT_LIMIT' } })

    const timed = createFixture({ ...readDefinition, timeoutMs: 5 }, blockingExecutor())
    expect(
      (await collect(timed.service.execute(readCall(), context(['tools/local/command/shell/run@1'])))).at(-1)
    ).toMatchObject({ type: 'tool.failed', error: { code: 'TOOL_TIMEOUT' } })

    const controller = new AbortController()
    const cancelled = createFixture(readDefinition, blockingExecutor())
    const pending = collect(
      cancelled.service.execute(readCall(), context(['tools/local/command/shell/run@1']), controller.signal)
    )
    await waitFor(() => cancelled.commits.some(({ invocation }) => invocation.status === 'running'))
    controller.abort()
    expect((await pending).at(-1)).toMatchObject({ type: 'tool.cancelled' })
  })

  it('surfaces a persistence failure after completion instead of an invalid transition', async () => {
    const executor: ToolExecutor = {
      async *execute() {
        yield { kind: 'result', output: { ok: true } }
      }
    }
    const registry = new RuntimeToolRegistry()
    registry.register(readDefinition, executor)
    const service = new ToolInvocationService({
      registry,
      policy: new RuntimeToolPolicy(),
      persistence: {
        async commitToolInvocationWithEvent(invocation, event) {
          if (invocation.status === 'completed') {
            throw new Error('PERSISTENCE_PAYLOAD_REJECTED: toolInvocation.output')
          }
          return { ...event, cursor: 1 }
        }
      },
      clock: { now: () => '2026-01-01T00:00:00.000Z' }
    })
    await expect(
      collect(service.execute(readCall(), context(['tools/local/command/shell/run@1'])))
    ).rejects.toThrow('PERSISTENCE_PAYLOAD_REJECTED: toolInvocation.output')
  })

  it('keeps streamed screen text out of persistence and interaction logs while the caller receives it', async () => {
    const secret = 'private screen text'
    const executor: ToolExecutor = {
      async *execute() {
        yield { kind: 'content', stream: 'result', delta: secret }
        yield { kind: 'result', output: { output: secret } }
      },
      redactForPersistence: (kind) => (kind === 'input' ? { codeLength: 10 } : { outputLength: 19 })
    }
    const fixture = createFixture(readDefinition, executor)
    const events = await collect(
      fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']))
    )
    expect(JSON.stringify(events)).toContain(secret)
    expect(JSON.stringify(fixture.commits)).not.toContain(secret)
    expect(JSON.stringify(await fixture.interactionStore.list({ limit: 20 }))).not.toContain(secret)
  })

  it('does not persist a redacting tool error containing private text', async () => {
    const fixture = createFixture(readDefinition, {
      async *execute() {
        yield await Promise.reject(new Error('private-error-654'))
      },
      redactForPersistence: () => ({ length: 0 })
    })
    const events = await collect(
      fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']))
    )
    expect(JSON.stringify(events)).toContain('private-error-654')
    expect(JSON.stringify(fixture.commits)).not.toContain('private-error-654')
    expect(JSON.stringify(await fixture.interactionStore.list({ limit: 20 }))).not.toContain(
      'private-error-654'
    )
  })

  it('persists a Computer Use guidance failure readably instead of redacting it', async () => {
    const fixture = createFixture(readDefinition, {
      async *execute() {
        yield await Promise.reject(new Error(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded))
      },
      redactForPersistence: () => ({ length: 0 })
    })
    const events = await collect(
      fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']))
    )
    expect(JSON.stringify(events)).toContain(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded)
    expect(JSON.stringify(fixture.commits)).toContain(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded)
    expect(JSON.stringify(await fixture.interactionStore.list({ limit: 20 }))).toContain(
      COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded
    )
    expect(JSON.stringify(fixture.commits)).not.toContain('[redacted')
  })

  it('refreshes input summaries after execution instead of persisting the initial snapshot forever', async () => {
    let lengths: number[] = []
    const fixture = createFixture(readDefinition, {
      async *execute() {
        lengths = [12]
        yield { kind: 'result', output: { output: 'done' } }
      },
      redactForPersistence: (kind) =>
        kind === 'input'
          ? { codeLength: 20, executedTextLengths: [...lengths] }
          : { outputLength: 4 }
    })
    await collect(fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1'])))
    expect(fixture.commits[0]?.invocation.input).toEqual({
      codeLength: 20,
      executedTextLengths: []
    })
    expect(fixture.commits.at(-1)?.invocation.input).toEqual({
      codeLength: 20,
      executedTextLengths: [12]
    })
  })

  it('persists the executor redaction while the caller keeps the full input and output', async () => {
    const executor: ToolExecutor = {
      async *execute() {
        yield {
          kind: 'result',
          output: { tree: { frame: { x: 1, y: 2 } }, observationId: 'obs-1' }
        }
      },
      redactForPersistence: (kind, value) =>
        kind === 'input'
          ? { redacted: 'input' }
          : { observationId: (value as { observationId: string }).observationId }
    }
    const fixture = createFixture(readDefinition, executor)
    const events = await collect(
      fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']))
    )
    expect(events.at(-1)).toMatchObject({
      type: 'tool.completed',
      output: { result: { tree: { frame: { x: 1, y: 2 } }, observationId: 'obs-1' } }
    })
    const persisted = JSON.stringify(fixture.commits)
    expect(persisted).not.toContain('"x":1')
    expect(persisted).not.toContain('README.md')
    expect(fixture.commits.at(-1)?.invocation.output).toMatchObject({
      result: { observationId: 'obs-1' }
    })
    expect(fixture.commits.at(-1)?.invocation.input).toEqual({ redacted: 'input' })
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
    modelName: 'tools_local_command_shell_run',
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

it('persists a crashed plugin side effect as unknown even after cancellation, without replay', async () => {
  const { PluginError } = await import('@action-driver/plugin-contracts')
  const controller = new AbortController()
  let executions = 0
  const fixture = createFixture({ ...readDefinition, sideEffects: { filesystem: 'write', network: false } }, {
    async *execute() { yield* []; executions++; controller.abort(); throw new PluginError('RESULT_UNKNOWN', 'host exited') }
  })
  const events = await collect(fixture.service.execute(readCall(), context(['tools/local/command/shell/run@1']), controller.signal))
  expect(events.at(-1)).toMatchObject({ type: 'tool.unknown', error: { code: 'TOOL_OUTCOME_UNKNOWN', retryable: false } })
  expect(fixture.commits.at(-1)?.invocation.status).toBe('unknown')
  expect(executions).toBe(1)
})

it('rejects old local model names even when an old grant exists', async () => {
  const execute = vi.fn(async function* (_call: ToolCall) {
    yield { kind: 'result' as const, output: { oldCallSucceeded: true } }
  })
  const fixture = createFixture(readDefinition, { execute })
  await expect(collect(fixture.service.execute({ ...readCall(), modelName: 'shell_run' }, context(['local.shell.run@1']))))
    .rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' })
  expect(execute).not.toHaveBeenCalled()
})
