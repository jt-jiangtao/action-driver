import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { startAgentRuntimeProcess } from '../src/runtime-process'
import { createScriptTools } from '../src/execution/tools'
import { startLocalOtelCollector } from '../../../tests/otel-collector'
import {
  RuntimeToolPolicy,
  RuntimeToolRegistry,
  SqliteRuntimeRepositories,
  openRuntimeDatabase
} from '../src/index'

vi.setConfig({ testTimeout: 20_000 })

const phoenixConstruction = vi.hoisted(() => vi.fn())
let collector: Awaited<ReturnType<typeof startLocalOtelCollector>>
beforeAll(async () => {
  collector = await startLocalOtelCollector()
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', collector.endpoint)
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await collector.close()
})
vi.mock('../src/phoenix-model-observability', () => ({
  PhoenixModelObservability: class {
    constructor(tracer: unknown) {
      phoenixConstruction(tracer)
    }
    async start() {}
    async finish() {}
  }
}))

class FakeParentPort extends EventEmitter {
  readonly postMessage = vi.fn()
}

describe('Agent Runtime process entry', () => {
  it('disables inherited LangChain tracing flags before running the graph', async () => {
    const keys = [
      'LANGSMITH_TRACING_V2',
      'LANGCHAIN_TRACING_V2',
      'LANGSMITH_TRACING',
      'LANGCHAIN_TRACING'
    ] as const
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    for (const key of keys) process.env[key] = 'true'
    const parentPort = new FakeParentPort()
    const exit = vi.fn()
    try {
      await startAgentRuntimeProcess(
        parentPort,
        join(mkdtempSync(join(tmpdir(), 'actiondriver-no-langsmith-')), 'runtime.db'),
        exit,
        {
          ACTIONDRIVER_WORKSPACE_ROOT: mkdtempSync(
            join(tmpdir(), 'actiondriver-no-langsmith-root-')
          )
        }
      )
      for (const key of keys) expect(process.env[key]).toBe('false')
    } finally {
      parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 10_000 })
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    }
  }, 20_000)

  it('wires the process tracer into Phoenix model observability', async () => {
    const parentPort = new FakeParentPort()
    const exit = vi.fn()
    const databasePath = join(mkdtempSync(join(tmpdir(), 'actiondriver-phoenix-')), 'runtime.db')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'actiondriver-phoenix-root-'))
    await startAgentRuntimeProcess(parentPort, databasePath, exit, {
      ACTIONDRIVER_WORKSPACE_ROOT: workspaceRoot
    })
    expect(phoenixConstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        startSpan: expect.any(Function)
      })
    )
    parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 10_000 })
  })

  it('refuses a second live Runtime before it can recover the first Runtime tasks', async () => {
    const databasePath = join(
      mkdtempSync(join(tmpdir(), 'actiondriver-single-owner-')),
      'runtime.db'
    )
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'actiondriver-single-owner-root-'))
    const firstParent = new FakeParentPort()
    const firstExit = vi.fn()
    const firstStart = startAgentRuntimeProcess(firstParent, databasePath, firstExit, {
      ACTIONDRIVER_WORKSPACE_ROOT: workspaceRoot
    })
    await firstStart
    try {
      const secondParent = new FakeParentPort()
      const secondStart = startAgentRuntimeProcess(secondParent, databasePath, vi.fn(), {
        ACTIONDRIVER_WORKSPACE_ROOT: workspaceRoot
      })
      await expect(secondStart).rejects.toThrow('RUNTIME_ALREADY_RUNNING')
      expect(secondParent.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'runtime.ready' })
      )
    } finally {
      firstParent.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
      await vi.waitFor(() => expect(firstExit).toHaveBeenCalledWith(0), { timeout: 10_000 })
    }
  })

  it('recovers an orphan before announcing readiness and does not append another terminal event on restart', async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'actiondriver-recovery-')), 'runtime.db')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'actiondriver-recovery-root-'))
    const repositories = new SqliteRuntimeRepositories(openRuntimeDatabase(databasePath))
    const timestamp = '2026-01-01T00:00:00.000Z'
    await repositories.createStreamTask({
      request: {
        requestId: 'orphan',
        idempotencyKey: 'orphan-key',
        sessionId: 'orphan-session',
        taskId: 'orphan-task',
        responseId: 'orphan-response',
        streamId: 'orphan-stream',
        messageId: 'orphan-assistant',
        status: 'running',
        lastSequence: -1,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      task: {
        id: 'orphan-task',
        threadId: 'orphan-task',
        sessionId: 'orphan-session',
        goal: 'work',
        model: { connectionId: 'connection', modelId: 'model' },
        status: 'running',
        error: null,
        lastCheckpointId: null,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      userMessage: {
        id: 'orphan-user',
        taskId: 'orphan-task',
        role: 'user',
        content: { text: 'work' },
        createdAt: timestamp
      },
      assistantMessage: {
        id: 'orphan-assistant',
        taskId: 'orphan-task',
        role: 'assistant',
        content: { text: '' },
        createdAt: timestamp
      },
      acceptedEvent: {
        taskId: 'orphan-task',
        threadId: 'orphan-session',
        checkpointId: 'orphan-response',
        eventKey: 'request.accepted',
        type: 'request.accepted',
        payload: {},
        occurredAt: timestamp,
        eventId: 'orphan-accepted',
        requestId: 'orphan',
        responseId: 'orphan-response',
        streamId: 'orphan-stream',
        messageId: 'orphan-assistant',
        sequence: null
      }
    })
    await repositories.toolInvocations.save({
      id: 'orphan-tool',
      providerCallId: 'orphan-provider',
      taskId: 'orphan-task',
      toolId: 'sandbox.shell.run',
      toolVersion: 1,
      argumentsHash: 'hash',
      decision: 'allow',
      status: 'running',
      input: { command: 'touch marker' },
      output: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    repositories.close()

    const child = spawn(
      process.execPath,
      [
        '-e',
        "const Database = require('better-sqlite3'); const db = new Database(process.argv[1]); " +
          "db.prepare('INSERT INTO runtime_process_owner (singleton, pid, token, acquired_at) VALUES (1, ?, ?, ?)').run(process.pid, 'crashed-owner', new Date().toISOString()); " +
          "db.prepare('UPDATE messages SET content_json = ? WHERE id = ?').run(" +
          "JSON.stringify({ text: 'partial' }), 'orphan-assistant'); " +
          "process.stdout.write('persisted\\n'); setInterval(() => {}, 1000)",
        databasePath
      ],
      { cwd: join(process.cwd(), 'apps/agent-runtime') }
    )
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve())
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error('writer exited early: ' + code)))
    })
    const terminated = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await terminated

    for (let boot = 0; boot < 2; boot += 1) {
      const parentPort = new FakeParentPort()
      const exit = vi.fn()
      const started = startAgentRuntimeProcess(parentPort, databasePath, exit, {
        ACTIONDRIVER_WORKSPACE_ROOT: workspaceRoot
      })
      await started
      const read = new SqliteRuntimeRepositories(openRuntimeDatabase(databasePath))
      expect((await read.streamRequests.getByRequestId('orphan'))?.status).toBe('failed')
      expect(
        (await read.events.listForRequestAfter('orphan', 0, 10)).filter(
          (event) => event.type === 'runtime.interrupted'
        )
      ).toHaveLength(1)
      expect((await read.messages.listByTask('orphan-task')).at(-1)?.content).toEqual({
        text: 'partial'
      })
      expect((await read.toolInvocations.listByTask('orphan-task'))[0]?.status).toBe('unknown')
      read.close()
      parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 10_000 })
    }
  })

  it('announces HTTP readiness and closes on shutdown', async () => {
    const parentPort = new FakeParentPort()
    const exit = vi.fn()
    const databasePath = join(mkdtempSync(join(tmpdir(), 'actiondriver-process-')), 'runtime.db')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'actiondriver-workspace-'))
    const started = startAgentRuntimeProcess(parentPort, databasePath, exit, {
      ACTIONDRIVER_WORKSPACE_ROOT: workspaceRoot
    })

    await started

    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'runtime.ready', service: null })

    parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 10_000 })
  })

  it('reports the HTTP service address when the client injected a token', async () => {
    const parentPort = new FakeParentPort()
    const exit = vi.fn()
    const databasePath = join(mkdtempSync(join(tmpdir(), 'actiondriver-http-')), 'runtime.db')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'actiondriver-workspace-'))

    const started = startAgentRuntimeProcess(parentPort, databasePath, exit, {
      ACTIONDRIVER_WORKSPACE_ROOT: workspaceRoot,
      ACTIONDRIVER_SERVICE_TOKEN: 'service-token',
      ACTIONDRIVER_CREDENTIAL_KEY: 'credential-secret',
      ACTIONDRIVER_RUNTIME_VERSION: '1.2.3',
      ACTIONDRIVER_RENDERER_ORIGIN: 'http://localhost:5173'
    })
    await started

    const readyMessage = parentPort.postMessage.mock.calls.find(
      ([message]) => (message as { type: string }).type === 'runtime.ready'
    )?.[0] as {
      type: string
      service: { baseUrl: string; streamPath: string; streamProtocol: string }
    }
    expect(readyMessage.service.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(readyMessage.service).toMatchObject({
      streamPath: '/stream',
      streamProtocol: 'actiondriver.stream.v2'
    })

    const socket = new WebSocket(
      `${readyMessage.service.baseUrl.replace('http:', 'ws:')}${readyMessage.service.streamPath}`,
      [readyMessage.service.streamProtocol],
      { origin: 'http://localhost:5173' }
    )
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const nextMessage = () =>
      new Promise<Record<string, unknown>>((resolve) => {
        socket.once('message', (data) =>
          resolve(JSON.parse(data.toString()) as Record<string, unknown>)
        )
      })
    let message = nextMessage()
    socket.send(
      JSON.stringify({
        type: 'auth',
        protocol: 'actiondriver.stream.v2',
        eventId: 'client-auth',
        createdAt: '2026-09-23T00:00:00.000Z',
        payload: { token: 'service-token' }
      })
    )
    await expect(message).resolves.toMatchObject({ type: 'session.ready' })
    message = nextMessage()
    socket.send(
      JSON.stringify({
        type: 'request.resume',
        protocol: 'actiondriver.stream.v2',
        eventId: 'client-resume',
        createdAt: '2026-09-23T00:00:01.000Z',
        requestId: 'missing-request',
        afterCursor: 0
      })
    )
    await expect(message).resolves.toMatchObject({
      type: 'request.error',
      requestId: 'missing-request'
    })
    socket.close()

    parentPort.emit('message', { data: { type: 'runtime.shutdown' }, ports: [] })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 10_000 })
  })

  it('rejects startup without a configured workspace root', async () => {
    const parentPort = new FakeParentPort()
    const databasePath = join(
      mkdtempSync(join(tmpdir(), 'actiondriver-root-missing-')),
      'runtime.db'
    )
    await expect(startAgentRuntimeProcess(parentPort, databasePath, vi.fn(), {})).rejects.toThrow(
      'SANDBOX_ROOT_INVALID'
    )
  })

  it('registers only current script tools for automatic use within the grant', async () => {
    const registry = new RuntimeToolRegistry()
    const policy = new RuntimeToolPolicy()
    const tools = await createScriptTools({
      runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
    })
    for (const tool of tools) registry.register(tool.definition, tool.executor)
    const grants = registry.list().map((tool) => `${tool.id}@${tool.version}`)
    expect(registry.list().map((tool) => tool.id)).toEqual([
      'tools/local/command/shell/run',
      'tools/local/command/python/run',
      'tools/local/command/node/run',
      'tools/local/command/typescript/run'
    ])
    expect(() => registry.resolveModelName('sandbox_fs_read')).toThrow('TOOL_UNAVAILABLE')
    expect(() => registry.resolveModelName('sandbox_fs_list')).toThrow('TOOL_UNAVAILABLE')
    const shell = registry.resolveModelName('tools_local_command_shell_run').definition
    expect(
      policy.decide(
        shell,
        {
          callId: 'shell',
          providerCallId: 'provider-shell',
          modelName: shell.modelName,
          arguments: { script: 'rg needle .' }
        },
        { grants }
      )
    ).toEqual({ kind: 'allow' })
    expect(() => registry.resolveModelName('unknown_tool')).toThrow('TOOL_UNAVAILABLE')
  })
})
