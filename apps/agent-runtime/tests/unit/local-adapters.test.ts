import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolEvent } from '@actiondriver/runtime-contracts'
import {
  SqliteRuntimeRepositories,
  createLocalRuntimeAdapters,
  createRuntimeServices,
  createSqliteCheckpointer,
  openRuntimeDatabase,
  type ModelGateway,
  type TaskRepository
} from '../../src/index'
import { createScriptTools } from '../../src/execution/tools'
import { SessionExecutionContextResolver } from '../../src/execution/session-execution-context'

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'actiondriver-local-runtime-')), 'actiondriver.db')
}

describe('local runtime adapters', () => {
  it('binds injected real model and SQLite ports without production Skill providers', async () => {
    const path = databasePath()
    const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(path))
    const checkpointer = createSqliteCheckpointer(path)
    const modelGateway: ModelGateway = {
      async complete() {
        return { kind: 'finish', content: 'real result' }
      }
    }
    const local = createLocalRuntimeAdapters({ repositories, checkpointer, modelGateway })
    const services = createRuntimeServices({ mode: 'local', adapters: local.adapters })
    const tasks: TaskRepository = services.taskRepository

    expect(services.modelGateway).toBe(modelGateway)
    expect(local.toolRuntime.registry.list()).toEqual([])
    expect(local.toolRuntime.grants).toEqual([])
    expect(() => local.adapters.skillRegistry.resolve('browser-use', 1)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(() => local.adapters.skillRegistry.resolve('computer-use', 1)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )

    await tasks.save({
      id: 'task-local',
      threadId: 'task-local',
      sessionId: 'task-local',
      goal: 'Persist locally',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      status: 'running',
      error: null,
      lastCheckpointId: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z'
    })

    await expect(tasks.get('task-local')).resolves.toMatchObject({ goal: 'Persist locally' })
    checkpointer.close()
    repositories.close()
  })

  it('runs script tools in the session workspace resolved from the persisted task', async () => {
    const path = databasePath()
    const database = openRuntimeDatabase(path)
    const repositories = new SqliteRuntimeRepositories(database)
    const checkpointer = createSqliteCheckpointer(path)
    const modelGateway: ModelGateway = {
      async complete() {
        return { kind: 'finish', content: 'real result' }
      }
    }
    const workspaceRoot = join(path, '..', 'workspace')
    const resolver = new SessionExecutionContextResolver({
      tasks: repositories.tasks,
      workspaceRoot
    })
    const local = createLocalRuntimeAdapters({
      repositories,
      checkpointer,
      modelGateway,
      executionContext: (taskId) => resolver.resolve(taskId)
    })
    const task = (id: string, sessionId: string) => ({
      id,
      threadId: id,
      sessionId,
      goal: 'run a script',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' },
      status: 'running',
      error: null,
      lastCheckpointId: null,
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z'
    })
    await repositories.tasks.save(task('task-a', 'session-a'))
    await repositories.tasks.save(task('task-b', 'session-b'))
    database
      .prepare(
        `INSERT INTO stream_requests
          (request_id, idempotency_key, session_id, task_id, response_id, stream_id, message_id,
           status, last_sequence, created_at, updated_at)
         VALUES ('request-1', 'idempotency-1', 'session-a', 'task-a', 'response-1', 'stream-1',
           'message-1', 'running', -1, '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`
      )
      .run()

    for (const tool of await createScriptTools({
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
    })) {
      local.toolRuntime.registry.register(tool.definition, tool.executor)
      local.toolRuntime.grants.push(`${tool.definition.id}@${tool.definition.version}`)
    }
    const call: ToolCall = {
      callId: 'call-a',
      providerCallId: 'provider-a',
      modelName: 'tools_local_command_shell_run',
      arguments: { script: 'printf session-a > output/marker.txt' }
    }
    const events: ToolEvent[] = []
    for await (const event of local.toolRuntime.invocations.execute(call, {
      taskId: 'task-a',
      threadId: 'task-a',
      checkpointId: 'checkpoint-1',
      requestId: 'request-1',
      grants: local.toolRuntime.grants
    })) {
      events.push(event)
    }

    expect(events.at(-1)).toMatchObject({ type: 'tool.completed' })
    const marker = join(workspaceRoot, 'sessions', 'session-a', 'output', 'marker.txt')
    expect(readFileSync(marker, 'utf8')).toBe('session-a')
    expect(existsSync(join(workspaceRoot, 'sessions', 'session-b', 'output', 'marker.txt'))).toBe(
      false
    )

    checkpointer.close()
    repositories.close()
  })
})
