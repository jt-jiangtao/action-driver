import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ToolCall,
  ToolDefinition,
  ToolEvent,
  ToolExecutionContext,
  ToolExecutor
} from '@actiondriver/runtime-contracts'
import {
  RuntimeToolPolicy,
  RuntimeToolRegistry,
  ToolInvocationService,
  openRuntimeDatabase,
  SqliteRuntimeRepositories,
  type PersistedToolInvocation,
  type RuntimeEventRecord,
  type RuntimeTaskRecord
} from '../src/index'
import {
  ExecutionContextUnavailableError,
  SessionExecutionContextResolver
} from '../src/execution/session-execution-context'

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function persistedTask(id: string, sessionId: string): RuntimeTaskRecord {
  return {
    id,
    threadId: id,
    sessionId,
    goal: 'goal',
    model: { connectionId: 'connection-1', modelId: 'model-1' },
    status: 'completed',
    error: null,
    lastCheckpointId: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z'
  }
}

async function createHarness(tasks: RuntimeTaskRecord[]) {
  const directory = temporaryDirectory('actiondriver-execution-context-')
  const database = openRuntimeDatabase(join(directory, 'actiondriver.db'))
  const repositories = new SqliteRuntimeRepositories(database)
  for (const task of tasks) await repositories.tasks.save(task)
  const workspaceRoot = join(directory, 'workspace')
  const resolver = new SessionExecutionContextResolver({
    tasks: repositories.tasks,
    workspaceRoot
  })
  return { database, repositories, resolver, workspaceRoot }
}

describe('trusted session execution context', () => {
  it('maps two tasks of one session to the same session workspace', async () => {
    const harness = await createHarness([
      persistedTask('task-a', 'session-shared'),
      persistedTask('task-b', 'session-shared')
    ])

    const first = await harness.resolver.resolve('task-a')
    const second = await harness.resolver.resolve('task-b')

    expect(first.sessionId).toBe('session-shared')
    expect(second.sessionId).toBe('session-shared')
    expect(first.taskId).toBe('task-a')
    expect(second.taskId).toBe('task-b')
    expect(second.workspace).toEqual(first.workspace)
    expect(first.workspace.root).toBe(join(harness.workspaceRoot, 'sessions', 'session-shared'))
    expect(first.workspace.input).toBe(join(first.workspace.root, 'input'))
    expect(first.workspace.output).toBe(join(first.workspace.root, 'output'))
  })

  it('keeps two sessions in different workspaces', async () => {
    const harness = await createHarness([
      persistedTask('task-a', 'session-a'),
      persistedTask('task-b', 'session-b')
    ])

    const first = await harness.resolver.resolve('task-a')
    const second = await harness.resolver.resolve('task-b')

    expect(first.workspace.root).toBe(join(harness.workspaceRoot, 'sessions', 'session-a'))
    expect(second.workspace.root).toBe(join(harness.workspaceRoot, 'sessions', 'session-b'))
    expect(first.workspace.root).not.toBe(second.workspace.root)
  })

  it('refuses to build a context for a task that was never persisted', async () => {
    const harness = await createHarness([persistedTask('task-a', 'session-a')])

    await expect(harness.resolver.resolve('caller-supplied-task')).rejects.toThrow(
      ExecutionContextUnavailableError
    )
    await expect(harness.resolver.resolve('caller-supplied-task')).rejects.toMatchObject({
      code: 'EXECUTION_CONTEXT_UNAVAILABLE'
    })
  })

  it('hands the resolved context to the tool executor', async () => {
    const harness = await createHarness([persistedTask('task-a', 'session-a')])
    const seen: ToolExecutionContext[] = []
    const fixture = createFixture(
      {
        async *execute(_call, _signal, context) {
          seen.push(context!)
          yield { kind: 'result', output: {} }
        }
      },
      { executionContext: (taskId) => harness.resolver.resolve(taskId) }
    )

    const events = await collect(fixture.service.execute(readCall(), invocationContext('task-a')))

    expect(events.at(-1)).toMatchObject({ type: 'tool.completed' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      taskId: 'task-a',
      sessionId: 'session-a',
      workspace: { root: join(harness.workspaceRoot, 'sessions', 'session-a') }
    })
  })

  it('fails the call without running the tool when the trusted context is unavailable', async () => {
    const harness = await createHarness([persistedTask('task-a', 'session-a')])
    const executed: string[] = []
    const fixture = createFixture(
      {
        async *execute() {
          executed.push('ran')
          yield { kind: 'result', output: {} }
        }
      },
      { executionContext: (taskId) => harness.resolver.resolve(taskId) }
    )

    const events = await collect(
      fixture.service.execute(readCall(), invocationContext('unknown-task'))
    )

    expect(executed).toEqual([])
    expect(events.at(-1)).toMatchObject({
      type: 'tool.failed',
      error: { code: 'EXECUTION_CONTEXT_UNAVAILABLE' }
    })
  })
})

const definition: ToolDefinition = {
  id: 'tools.local.command.shell.run',
  version: 1,
  modelName: 'tools_local_command_shell_run',
  description: 'Run a script',
  inputSchema: { type: 'object', properties: { script: { type: 'string' } } },
  risk: 'high',
  sideEffects: { filesystem: 'write', network: true },
  timeoutMs: 5_000
}

function readCall(): ToolCall {
  return {
    callId: 'call-1',
    providerCallId: 'provider-1',
    modelName: 'tools_local_command_shell_run',
    arguments: { script: 'true' }
  }
}

export function invocationContext(taskId: string) {
  return {
    taskId,
    threadId: taskId,
    checkpointId: 'checkpoint-1',
    requestId: 'request-1',
    grants: [`${definition.id}@${definition.version}`]
  }
}

function createFixture(
  executor: ToolExecutor,
  options: { executionContext?: (taskId: string) => Promise<ToolExecutionContext> } = {}
) {
  const registry = new RuntimeToolRegistry()
  registry.register(definition, executor)
  const commits: Array<{
    invocation: PersistedToolInvocation
    event: Omit<RuntimeEventRecord, 'cursor'>
  }> = []
  let cursor = 0
  const service = new ToolInvocationService({
    registry,
    policy: new RuntimeToolPolicy(),
    persistence: {
      async commitToolInvocationWithEvent(invocation, event) {
        commits.push({ invocation: structuredClone(invocation), event: structuredClone(event) })
        return { ...event, cursor: ++cursor }
      }
    },
    clock: { now: () => '2026-09-26T00:00:00.000Z' },
    ...options
  })
  return { service, commits }
}

async function collect(events: AsyncIterable<ToolEvent>): Promise<ToolEvent[]> {
  const collected: ToolEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}
