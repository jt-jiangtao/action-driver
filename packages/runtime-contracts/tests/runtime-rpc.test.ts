import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeClient,
  RuntimeServer,
  type RuntimeMessageEndpoint,
  type RuntimeMessageListener,
  type RuntimeRpcError,
  type RuntimeEvent,
  type SkillExecuteRequest
} from '../src'

class MemoryEndpoint implements RuntimeMessageEndpoint {
  peer: MemoryEndpoint | null = null
  private readonly messageListeners = new Set<RuntimeMessageListener>()
  private readonly closeListeners = new Set<() => void>()
  private closed = false

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('Endpoint is closed')
    queueMicrotask(() => {
      if (!this.peer?.closed) this.peer?.emitMessage(structuredClone(message))
    })
  }

  onMessage(listener: RuntimeMessageListener): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  disconnect(): void {
    if (this.closed) return
    this.closed = true
    const peer = this.peer
    this.emitClose()
    if (peer && !peer.closed) {
      peer.closed = true
      peer.emitClose()
    }
  }

  private emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message)
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) listener()
  }
}

function createEndpointPair(): [MemoryEndpoint, MemoryEndpoint] {
  const first = new MemoryEndpoint()
  const second = new MemoryEndpoint()
  first.peer = second
  second.peer = first
  return [first, second]
}

function createConnectedPair(options: {
  onCommand?: (command: string, input: unknown) => unknown | Promise<unknown>
  onSkillExecute?: (request: SkillExecuteRequest) => unknown | Promise<unknown>
  readEvents?: (taskId: string, afterCursor: number) => RuntimeEvent[] | Promise<RuntimeEvent[]>
  onDiagnostic?: (error: RuntimeRpcError) => void
} = {}) {
  const [clientEndpoint, serverEndpoint] = createEndpointPair()
  let nextId = 0
  const requestIdFactory = () => `request-${++nextId}`
  const server = new RuntimeServer(serverEndpoint, {
    runtimeVersion: '0.1.0',
    capabilities: ['commands.v1', 'skills.v1'],
    onCommand: options.onCommand ?? (() => ({ accepted: true })),
    ...(options.readEvents ? { readEvents: options.readEvents } : {}),
    requestIdFactory,
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {})
  })
  const client = new RuntimeClient(clientEndpoint, {
    appVersion: '0.1.0',
    capabilities: ['commands.v1', 'skills.v1', 'events.v1'],
    onSkillExecute: options.onSkillExecute ?? (() => ({ event: { type: 'completed' } })),
    requestIdFactory,
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {})
  })
  return { client, server, clientEndpoint, serverEndpoint }
}

describe('runtime RPC', () => {
  it('negotiates capabilities before accepting commands and preserves request ids', async () => {
    const onCommand = vi.fn((_command: string, input: unknown) => ({ taskId: input }))
    const { client } = createConnectedPair({ onCommand })

    const submit = {
      goal: 'go',
      model: { connectionId: 'connection-a', modelId: 'shared-model' },
      skills: [] as []
    }
    await expect(client.request('task.submit', submit)).rejects.toMatchObject({
      code: 'HANDSHAKE_REQUIRED'
    })

    await expect(client.connect()).resolves.toEqual({
      runtimeVersion: '0.1.0',
      capabilities: ['commands.v1', 'skills.v1']
    })
    await expect(client.request('task.submit', submit)).resolves.toEqual({
      taskId: submit
    })
    expect(onCommand).toHaveBeenCalledWith('task.submit', submit)
  })

  it('preserves the selected connection when model ids are duplicated', async () => {
    const onCommand = vi.fn((_command: string, input: unknown) => ({ taskId: input }))
    const { client } = createConnectedPair({ onCommand })
    await client.connect()

    const request = {
      goal: 'hello',
      model: { connectionId: 'second', modelId: 'shared-model' },
      skills: [] as []
    }
    await expect(client.request('task.submit', request)).resolves.toEqual({ taskId: request })
    expect(onCommand).toHaveBeenCalledWith('task.submit', request)
  })

  it('rejects a blank model connection before dispatch', async () => {
    const onCommand = vi.fn()
    const { client } = createConnectedPair({ onCommand })
    await client.connect()

    await expect(
      client.request('task.submit', {
        goal: 'hello',
        model: { connectionId: '', modelId: 'shared-model' },
        skills: []
      })
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('rejects expired requests before dispatch and makes timeouts terminal', async () => {
    vi.useFakeTimers()
    const diagnostics: RuntimeRpcError[] = []
    let resolveCommand: ((value: unknown) => void) | undefined
    const { client } = createConnectedPair({
      onCommand: () => new Promise((resolve) => (resolveCommand = resolve)),
      onDiagnostic: (error) => diagnostics.push(error)
    })
    await client.connect()

    const pending = client.request('task.get', { taskId: 'task-1' }, { deadlineUnixMs: Date.now() + 50 })
    const rejection = expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    await vi.advanceTimersByTimeAsync(51)
    await rejection

    resolveCommand?.({ task: { id: 'late' } })
    await vi.runAllTimersAsync()
    expect(diagnostics.some((error) => error.code === 'LATE_RESPONSE')).toBe(true)
    vi.useRealTimers()
  })

  it('validates inbound messages before dispatch', async () => {
    const onCommand = vi.fn()
    const diagnostics: RuntimeRpcError[] = []
    const { client, serverEndpoint } = createConnectedPair({
      onCommand,
      onDiagnostic: (error) => diagnostics.push(error)
    })
    await client.connect()

    serverEndpoint.postMessage({
      type: 'command.request',
      requestId: '',
      version: { major: 1, minor: 0 },
      deadlineUnixMs: Date.now() + 1_000,
      payload: { command: 'task.submit', input: { goal: 'invalid' } }
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(onCommand).not.toHaveBeenCalled()
    expect(diagnostics.some((error) => error.code === 'INVALID_MESSAGE')).toBe(true)
  })

  it('rejects already expired inbound commands before calling the handler', async () => {
    const onCommand = vi.fn()
    const { client, clientEndpoint } = createConnectedPair({ onCommand })
    await client.connect()
    const received: unknown[] = []
    clientEndpoint.onMessage((message) => received.push(message))

    clientEndpoint.postMessage({
      type: 'command.request',
      requestId: 'expired-command',
      version: { major: 1, minor: 0 },
      deadlineUnixMs: Date.now() - 1,
      payload: {
        command: 'task.submit',
        input: {
          goal: 'must not run',
          model: { connectionId: 'connection-a', modelId: 'shared-model' },
          skills: []
        }
      }
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(onCommand).not.toHaveBeenCalled()
    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'command.response',
        requestId: 'expired-command',
        payload: expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'DEADLINE_EXCEEDED' })
        })
      })
    )
  })

  it('supports Runtime-to-Main skill requests over the same channel', async () => {
    const onSkillExecute = vi.fn((request: SkillExecuteRequest) => ({
      event: { type: 'completed', invocationId: request.invocationId },
      output: { title: 'Example' }
    }))
    const { client, server } = createConnectedPair({ onSkillExecute })
    await client.connect()

    await expect(
      server.requestSkill({
        invocationId: 'invocation-1',
        requestedSkillId: 'browser-use',
        resolvedProviderId: 'browser-use.mock',
        providerVersion: '1.0.0',
        input: { action: 'read-title' }
      })
    ).resolves.toMatchObject({ output: { title: 'Example' } })
    expect(onSkillExecute).toHaveBeenCalledOnce()
  })

  it('fails every pending request on disconnect in both directions', async () => {
    const never = () => new Promise<never>(() => undefined)
    const { client, server, clientEndpoint } = createConnectedPair({
      onCommand: never,
      onSkillExecute: never
    })
    await client.connect()

    const command = client.request('task.get', { taskId: 'task-1' })
    const skill = server.requestSkill({
      invocationId: 'invocation-1',
      requestedSkillId: 'computer-use',
      resolvedProviderId: 'computer-use.mock',
      providerVersion: '1.0.0',
      input: {}
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    clientEndpoint.disconnect()

    await expect(command).rejects.toMatchObject({ code: 'RUNTIME_DISCONNECTED' })
    await expect(skill).rejects.toMatchObject({ code: 'RUNTIME_DISCONNECTED' })
  })

  it('resumes event subscriptions from cursor + 1 and ignores duplicate or late events', async () => {
    const event = (cursor: number): RuntimeEvent => ({
      cursor,
      taskId: 'task-1',
      type: 'task.updated',
      payload: { cursor },
      occurredAt: '2026-09-20T00:00:00.000Z'
    })
    const readEvents = vi.fn((_taskId: string, afterCursor: number) =>
      [event(5), event(6), event(7)].filter((item) => item.cursor > afterCursor)
    )
    const first = createConnectedPair({ readEvents })
    const applied: number[] = []
    await first.client.connect()

    const subscription = await first.client.subscribeEvents(
      'task-1',
      4,
      (item) => applied.push(item.cursor)
    )
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(readEvents).toHaveBeenCalledWith('task-1', 4)
    expect(applied).toEqual([5, 6, 7])
    expect(subscription.cursor).toBe(7)

    first.server.publishEvent(event(7))
    first.server.publishEvent(event(6))
    first.server.publishEvent(event(8))
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(applied).toEqual([5, 6, 7, 8])
    expect(subscription.cursor).toBe(8)

    first.clientEndpoint.disconnect()
    const second = createConnectedPair({ readEvents })
    await second.client.connect()
    await second.client.subscribeEvents('task-1', subscription.cursor, (item) =>
      applied.push(item.cursor)
    )
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(readEvents).toHaveBeenLastCalledWith('task-1', 8)
    expect(applied).toEqual([5, 6, 7, 8])
  })
})
