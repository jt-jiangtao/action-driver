import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import { RendererStreamClient } from './renderer-stream-client'

let server: WebSocketServer | undefined
let client: RendererStreamClient | undefined

afterEach(async () => {
  await client?.close()
  client = undefined
  if (server) {
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

async function listen(): Promise<string> {
  server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP server')
  return `ws://127.0.0.1:${address.port}/stream`
}

function send(socket: WebSocket, event: StreamServerEvent): void {
  socket.send(JSON.stringify(event))
}

const identity = {
  protocol: 'actiondriver.stream.v1' as const,
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'message-1'
}

describe('RendererStreamClient', () => {
  it('sends a tool decision on the authenticated stream and resolves only after a tool status event', async () => {
    const wsUrl = await listen()
    const frames: Array<{
      type: string
      requestId?: string
      taskId?: string
      callId?: string
      argumentsHash?: string
    }> = []
    let requestId = ''
    server!.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as (typeof frames)[number]
        frames.push(frame)
        if (frame.type === 'auth')
          send(socket, {
            type: 'session.ready',
            protocol: 'actiondriver.stream.v1',
            eventId: 'ready-tool',
            connectionId: 'connection-1',
            capabilities: ['request.create', 'tool.approve'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        if (frame.type === 'request.create') {
          requestId = frame.requestId!
          send(socket, {
            type: 'request.accepted',
            ...identity,
            requestId,
            eventId: 'accepted-tool',
            cursor: 1,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
        }
        if (frame.type === 'tool.approve')
          send(socket, {
            type: 'tool.queued',
            ...identity,
            requestId,
            eventId: 'tool-queued',
            cursor: 2,
            occurredAt: '2026-09-23T00:00:02.000Z',
            callId: 'call-1',
            callSequence: 2,
            toolId: 'sandbox.shell.run',
            modelName: 'sandbox_shell_run',
            summary: 'rg TODO README.md',
            argumentsHash: 'sha256:abc'
          })
      })
    })
    client = new RendererStreamClient({
      getConnection: async () => ({
        wsUrl,
        protocol: 'actiondriver.stream.v1',
        accessToken: 'token'
      }),
      createWebSocket: (url, protocols) => new WebSocket(url, protocols)
    })
    await client.create({
      goal: 'search',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    await expect(client.approveTool('task-1', 'call-1', 'sha256:abc')).resolves.toBeUndefined()
    expect(frames.at(-1)).toMatchObject({
      type: 'tool.approve',
      requestId,
      taskId: 'task-1',
      callId: 'call-1',
      argumentsHash: 'sha256:abc'
    })
  })
  it('uses real WebSocket auth first and keeps the launch token out of the URL', async () => {
    const wsUrl = await listen()
    const requests: string[] = []
    const frames: Array<{ type: string; payload?: unknown }> = []
    server!.on('connection', (socket, request) => {
      requests.push(request.url ?? '')
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; payload?: unknown }
        frames.push(frame)
        if (frame.type === 'auth') {
          send(socket, {
            type: 'session.ready',
            protocol: 'actiondriver.stream.v1',
            eventId: 'ready-1',
            connectionId: 'connection-1',
            capabilities: ['request.create'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        }
        if (frame.type === 'request.create') {
          send(socket, {
            type: 'request.accepted',
            ...identity,
            eventId: 'accepted-1',
            cursor: 1,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
        }
      })
    })
    const getConnection = vi.fn(async () => ({
      wsUrl,
      protocol: 'actiondriver.stream.v1' as const,
      accessToken: 'launch-token'
    }))
    let id = 0
    client = new RendererStreamClient({
      getConnection,
      createWebSocket: (url, protocols) => new WebSocket(url, protocols),
      id: () => ['auth-1', 'request-1', 'idempotency-1', 'create-1'][id++] ?? `id-${id}`,
      retryDelay: () => 0
    })

    await expect(
      client.create({
        goal: 'Say hello',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
    ).resolves.toMatchObject(identity)

    expect(requests).toEqual(['/stream'])
    expect(requests.join('')).not.toContain('launch-token')
    expect(frames.map((frame) => frame.type)).toEqual(['auth', 'request.create'])
    expect(frames[0]).toMatchObject({ payload: { token: 'launch-token' } })
    expect(getConnection).toHaveBeenCalledOnce()
  })

  it('reconnects to the real server and resumes after the last delivered cursor', async () => {
    const wsUrl = await listen()
    let connections = 0
    const frames: Array<{ type: string; afterCursor?: number }> = []
    server!.on('connection', (socket) => {
      connections += 1
      const connection = connections
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; afterCursor?: number }
        frames.push(frame)
        if (frame.type === 'auth') {
          send(socket, {
            type: 'session.ready',
            protocol: 'actiondriver.stream.v1',
            eventId: `ready-${connection}`,
            connectionId: `connection-${connection}`,
            capabilities: ['request.create', 'request.resume'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        }
        if (frame.type === 'request.create') {
          send(socket, {
            type: 'request.accepted',
            ...identity,
            eventId: 'accepted-1',
            cursor: 1,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
          send(socket, {
            type: 'response.start',
            ...identity,
            eventId: 'start-1',
            cursor: 2,
            occurredAt: '2026-09-23T00:00:02.000Z',
            sequence: 0,
            model: { connectionId: 'connection-1', modelId: 'gpt-real' }
          })
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-1',
            cursor: 3,
            occurredAt: '2026-09-23T00:00:03.000Z',
            sequence: 1,
            delta: 'A',
            contentIndex: 0
          })
          socket.close(1012, 'restart')
        }
        if (frame.type === 'request.resume') {
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-1',
            cursor: 3,
            occurredAt: '2026-09-23T00:00:03.000Z',
            sequence: 1,
            delta: 'A',
            contentIndex: 0
          })
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-2',
            cursor: 4,
            occurredAt: '2026-09-23T00:00:04.000Z',
            sequence: 2,
            delta: 'B',
            contentIndex: 0
          })
          send(socket, {
            type: 'response.end',
            ...identity,
            eventId: 'end-1',
            cursor: 5,
            occurredAt: '2026-09-23T00:00:05.000Z',
            sequence: 3,
            status: 'completed',
            content: 'AB',
            finishReason: 'stop',
            usage: null,
            durationMs: 4,
            error: null
          })
        }
      })
    })
    client = new RendererStreamClient({
      getConnection: async () => ({
        wsUrl,
        protocol: 'actiondriver.stream.v1',
        accessToken: 'launch-token'
      }),
      createWebSocket: (url, protocols) => new WebSocket(url, protocols),
      id: () => 'request-1',
      retryDelay: () => 0
    })
    const deltas: string[] = []
    const ended = new Promise<void>((resolve) => {
      client!.subscribe((event) => {
        if (event.type === 'response.content') deltas.push(event.delta)
        if (event.type === 'response.end') resolve()
      })
    })

    await client.create({
      goal: 'stream',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    await ended

    expect(connections).toBe(2)
    expect(deltas).toEqual(['A', 'B'])
    expect(frames).toContainEqual(
      expect.objectContaining({ type: 'request.resume', afterCursor: 3 })
    )
  })

  it('does not expose the launch token through authentication errors', async () => {
    const wsUrl = await listen()
    server!.on('connection', (socket) => {
      socket.once('message', () => socket.close(1008, 'launch-token'))
    })
    client = new RendererStreamClient({
      getConnection: async () => ({
        wsUrl,
        protocol: 'actiondriver.stream.v1',
        accessToken: 'launch-token'
      }),
      createWebSocket: (url, protocols) => new WebSocket(url, protocols),
      id: () => 'event-1',
      retryDelay: () => 0
    })

    const error = await client
      .create({
        goal: 'hello',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('launch-token')
  })
})
