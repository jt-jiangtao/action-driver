import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'
import { RuntimeStreamClient } from './runtime-stream-client'

let server: WebSocketServer | undefined
let client: RuntimeStreamClient | undefined

afterEach(async () => {
  await client?.close()
  client = undefined
  if (server) {
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

async function listen() {
  server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP server')
  return `http://127.0.0.1:${address.port}`
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

describe('RuntimeStreamClient', () => {
  it('authenticates, correlates create, delivers events once, and advances after listener delivery', async () => {
    const baseUrl = await listen()
    const received: unknown[] = []
    server!.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string }
        received.push(message)
        if (message.type === 'auth') {
          send(socket, {
            type: 'session.ready',
            protocol: 'actiondriver.stream.v1',
            eventId: 'ready-1',
            connectionId: 'connection-1',
            capabilities: ['request.create', 'request.cancel', 'request.resume'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        }
        if (message.type === 'request.create') {
          const accepted: StreamServerEvent = {
            type: 'request.accepted',
            ...identity,
            eventId: 'accepted-1',
            cursor: 1,
            occurredAt: '2026-09-23T00:00:01.000Z'
          }
          send(socket, accepted)
          send(socket, accepted)
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
            type: 'response.end',
            ...identity,
            eventId: 'end-1',
            cursor: 3,
            occurredAt: '2026-09-23T00:00:03.000Z',
            sequence: 1,
            status: 'completed',
            content: 'done',
            finishReason: 'stop',
            usage: null,
            durationMs: 1,
            error: null
          })
        }
      })
    })
    client = new RuntimeStreamClient({
      WebSocket,
      id: (() => {
        const values = ['client-auth', 'request-1', 'idempotency-1']
        return () => values.shift() ?? 'client-event'
      })(),
      retryDelay: () => 0
    })
    const delivered: StreamServerEvent[] = []
    client.subscribe((event) => delivered.push(event))
    await client.connect({ baseUrl, token: 'service-token' })
    const ended = new Promise<void>((resolve) => {
      client!.subscribe((event) => {
        if (event.type === 'response.end') resolve()
      })
    })

    await expect(
      client.create({
        goal: 'Say hello',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' },
        systemPrompt: 'Be concise.'
      })
    ).resolves.toMatchObject(identity)
    await ended

    expect(received.map((message) => (message as { type: string }).type)).toEqual([
      'auth',
      'request.create'
    ])
    expect(delivered.map((event) => event.eventId)).toEqual(['accepted-1', 'start-1', 'end-1'])
  })

  it('reconnects retryable closes and resumes after the last delivered cursor without duplicating content', async () => {
    const baseUrl = await listen()
    let connections = 0
    const clientMessages: Array<{ type: string; afterCursor?: number }> = []
    server!.on('connection', (socket) => {
      connections += 1
      const connection = connections
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; afterCursor?: number }
        clientMessages.push(message)
        if (message.type === 'auth') {
          send(socket, {
            type: 'session.ready',
            protocol: 'actiondriver.stream.v1',
            eventId: `ready-${connection}`,
            connectionId: `connection-${connection}`,
            capabilities: ['request.create', 'request.resume'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        }
        if (message.type === 'request.create') {
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
        if (message.type === 'request.resume') {
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-1',
            cursor: 3,
            occurredAt: '2026-09-23T00:00:02.000Z',
            sequence: 1,
            delta: 'A',
            contentIndex: 0
          })
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-2',
            cursor: 4,
            occurredAt: '2026-09-23T00:00:03.000Z',
            sequence: 2,
            delta: 'B',
            contentIndex: 0
          })
          send(socket, {
            type: 'response.end',
            ...identity,
            eventId: 'end-1',
            cursor: 5,
            occurredAt: '2026-09-23T00:00:04.000Z',
            sequence: 3,
            status: 'completed',
            content: 'AB',
            finishReason: 'stop',
            usage: null,
            durationMs: 3,
            error: null
          })
        }
      })
    })
    client = new RuntimeStreamClient({ WebSocket, id: () => 'request-1', retryDelay: () => 0 })
    const deltas: string[] = []
    const ended = new Promise<void>((resolve) => {
      client!.subscribe((event) => {
        if (event.type === 'response.content') deltas.push(event.delta)
        if (event.type === 'response.end') resolve()
      })
    })
    await client.connect({ baseUrl, token: 'service-token' })
    await client.create({
      goal: 'stream',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    await ended

    expect(connections).toBe(2)
    expect(deltas).toEqual(['A', 'B'])
    expect(clientMessages).toContainEqual(
      expect.objectContaining({
        type: 'request.resume',
        afterCursor: 3
      })
    )
  })

  it('treats 1008 authentication closure as non-retryable', async () => {
    const baseUrl = await listen()
    let connections = 0
    server!.on('connection', (socket) => {
      connections += 1
      socket.once('message', () => socket.close(1008, 'Unauthorized'))
    })
    client = new RuntimeStreamClient({ WebSocket, id: () => 'event-1', retryDelay: () => 0 })

    await expect(client.connect({ baseUrl, token: 'wrong-token' })).rejects.toThrow('Unauthorized')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(connections).toBe(1)
  })

  it('re-sends the same idempotent create when disconnect happens before accepted', async () => {
    const baseUrl = await listen()
    let connections = 0
    const creates: Array<{ requestId: string; idempotencyKey: string }> = []
    server!.on('connection', (socket) => {
      connections += 1
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as {
          type: string
          requestId: string
          idempotencyKey: string
        }
        if (message.type === 'auth') {
          send(socket, {
            type: 'session.ready',
            protocol: 'actiondriver.stream.v1',
            eventId: `ready-${connections}`,
            connectionId: `connection-${connections}`,
            capabilities: ['request.create'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        }
        if (message.type === 'request.create') {
          creates.push({
            requestId: message.requestId,
            idempotencyKey: message.idempotencyKey
          })
          if (connections === 1) {
            socket.close(1012, 'restart before accepted')
            return
          }
          send(socket, {
            type: 'request.accepted',
            ...identity,
            requestId: message.requestId,
            eventId: 'accepted-after-reconnect',
            cursor: 1,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
        }
      })
    })
    let id = 0
    client = new RuntimeStreamClient({
      WebSocket,
      id: () => `client-id-${++id}`,
      retryDelay: () => 0
    })
    await client.connect({ baseUrl, token: 'service-token' })

    await expect(
      client.create({
        goal: 'retry me',
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
    ).resolves.toMatchObject({ type: 'request.accepted' })
    expect(creates).toHaveLength(2)
    expect(creates[1]).toEqual(creates[0])
  })
})
