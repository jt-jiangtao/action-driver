import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import fc from 'fast-check'
import type { StreamServerEvent } from '@action-driver/runtime-contracts'
import { RendererStreamClient } from '../../../../../../src/renderer/src/services/agent-session/renderer-stream-client'

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
  protocol: 'action-driver.stream.v2' as const,
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  responseId: 'response-1',
  streamId: 'stream-1',
  messageId: 'message-1'
}

describe('RendererStreamClient', () => {
  it('delivers each request event once for shuffled frames and duplicates (seed 240924)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([1, 2, 3, 4], { minLength: 4, maxLength: 4 }),
        async (order) => {
          const wsUrl = await listen()
          server!.on('connection', (socket) => {
            socket.on('message', (raw) => {
              const frame = JSON.parse(raw.toString()) as { type: string; requestId?: string }
              if (frame.type === 'auth') {
                send(socket, {
                  type: 'session.ready',
                  protocol: 'action-driver.stream.v2',
                  eventId: 'ready-property',
                  connectionId: 'connection-1',
                  capabilities: ['request.create', 'request.resume'],
                  occurredAt: '2026-09-23T00:00:00.000Z'
                })
              }
              if (frame.type !== 'request.create') return
              const requestId = frame.requestId!
              const common = {
                ...identity,
                requestId,
                occurredAt: '2026-09-23T00:00:01.000Z'
              }
              send(socket, {
                type: 'request.accepted',
                ...common,
                eventId: 'accepted-property',
                cursor: 1,
                sequence: 0
              })
              const events: StreamServerEvent[] = [
                {
                  type: 'response.start',
                  ...common,
                  eventId: 'start-property',
                  cursor: 3,
                  sequence: 1,
                  model: { connectionId: 'connection-1', modelId: 'gpt-real' }
                },
                {
                  type: 'response.content',
                  ...common,
                  eventId: 'a-property',
                  cursor: 5,
                  sequence: 2,
                  delta: 'A',
                  contentIndex: 0
                },
                {
                  type: 'response.content',
                  ...common,
                  eventId: 'b-property',
                  cursor: 7,
                  sequence: 3,
                  delta: 'B',
                  contentIndex: 0
                },
                {
                  type: 'response.end',
                  ...common,
                  eventId: 'end-property',
                  cursor: 9,
                  sequence: 4,
                  status: 'completed',
                  content: 'AB',
                  finishReason: 'stop',
                  usage: null,
                  durationMs: 1,
                  error: null
                }
              ]
              for (const sequence of order) send(socket, events[sequence - 1]!)
              send(socket, events[order[0]! - 1]!)
            })
          })
          client = new RendererStreamClient({
            getConnection: async () => ({
              wsUrl,
              protocol: 'action-driver.stream.v2',
              accessToken: 'token'
            }),
            createWebSocket: (url, protocols) => new WebSocket(url, protocols),
            id: () => 'request-property'
          })
          const delivered: number[] = []
          const ended = new Promise<void>((resolve) =>
            client!.subscribe((event) => {
              if ('sequence' in event) delivered.push(event.sequence)
              if (event.type === 'response.end') resolve()
            })
          )
          try {
            await client.create({
              goal: 'property',
              model: { connectionId: 'connection-1', modelId: 'gpt-real' }
            })
            await Promise.race([
              ended,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('sequence stalled')), 500)
              )
            ])
            expect(delivered).toEqual([0, 1, 2, 3, 4])
          } finally {
            await client.close()
            client = undefined
            for (const socket of server!.clients) socket.terminate()
            await new Promise<void>((resolve) => server!.close(() => resolve()))
            server = undefined
          }
        }
      ),
      { seed: 240924, numRuns: 16 }
    )
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
            protocol: 'action-driver.stream.v2',
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
            sequence: 0,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
        }
      })
    })
    const getConnection = vi.fn(async () => ({
      wsUrl,
      protocol: 'action-driver.stream.v2' as const,
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
        imageAssetIds: ['staged-1'],
        inputFileIds: ['file-1'],
        model: { connectionId: 'connection-1', modelId: 'gpt-real' }
      })
    ).resolves.toMatchObject(identity)

    expect(requests).toEqual(['/stream'])
    expect(requests.join('')).not.toContain('launch-token')
    expect(frames.map((frame) => frame.type)).toEqual(['auth', 'request.create'])
    expect(frames[0]).toMatchObject({ payload: { token: 'launch-token' } })
    expect(frames[1]).toMatchObject({
      payload: { input: { imageAssetIds: ['staged-1'], inputFileIds: ['file-1'] } }
    })
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
            protocol: 'action-driver.stream.v2',
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
            sequence: 0,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
          send(socket, {
            type: 'response.start',
            ...identity,
            eventId: 'start-1',
            cursor: 2,
            occurredAt: '2026-09-23T00:00:02.000Z',
            sequence: 1,
            model: { connectionId: 'connection-1', modelId: 'gpt-real' }
          })
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-1',
            cursor: 3,
            occurredAt: '2026-09-23T00:00:03.000Z',
            sequence: 2,
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
            sequence: 2,
            delta: 'A',
            contentIndex: 0
          })
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-2',
            cursor: 4,
            occurredAt: '2026-09-23T00:00:04.000Z',
            sequence: 3,
            delta: 'B',
            contentIndex: 0
          })
          send(socket, {
            type: 'response.end',
            ...identity,
            eventId: 'end-1',
            cursor: 5,
            occurredAt: '2026-09-23T00:00:05.000Z',
            sequence: 4,
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
        protocol: 'action-driver.stream.v2',
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

  it('delivers replayed activity events in cursor order when realtime events arrive first', async () => {
    const wsUrl = await listen()
    server!.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; requestId?: string }
        if (frame.type === 'auth')
          send(socket, {
            type: 'session.ready',
            protocol: 'action-driver.stream.v2',
            eventId: 'ready-order',
            connectionId: 'connection-1',
            capabilities: ['request.create'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        if (frame.type === 'request.create') {
          send(socket, {
            type: 'request.accepted',
            ...identity,
            requestId: frame.requestId!,
            eventId: 'accepted-order',
            cursor: 1,
            sequence: 0,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
          send(socket, {
            type: 'response.start',
            ...identity,
            requestId: frame.requestId!,
            eventId: 'start-order',
            cursor: 3,
            occurredAt: '2026-09-23T00:00:02.000Z',
            sequence: 1,
            model: { connectionId: 'connection-1', modelId: 'gpt-real' }
          })
          send(socket, {
            type: 'tool.completed',
            ...identity,
            requestId: frame.requestId!,
            eventId: 'tool-order',
            cursor: 7,
            sequence: 3,
            occurredAt: '2026-09-23T00:00:04.000Z',
            callId: 'call-order',
            callSequence: 3,
            toolId: 'tools/local/command/shell/run',
            modelName: 'tools_local_command_shell_run',
            summary: '读取文件',
            argumentsHash: '',
            activityId: 'activity-order',
            durationMs: 1,
            resultSummary: '工具已完成'
          })
          send(socket, {
            type: 'activity.started',
            ...identity,
            requestId: frame.requestId!,
            eventId: 'activity-order',
            cursor: 5,
            sequence: 2,
            occurredAt: '2026-09-23T00:00:03.000Z',
            activityId: 'activity-order',
            title: '调研现有实现',
            titleRevision: 1
          })
        }
      })
    })
    client = new RendererStreamClient({
      getConnection: async () => ({
        wsUrl,
        protocol: 'action-driver.stream.v2',
        accessToken: 'token'
      }),
      createWebSocket: (url, protocols) => new WebSocket(url, protocols)
    })
    const received: string[] = []
    const complete = new Promise<void>((resolve) =>
      client!.subscribe((event) => {
        if ('cursor' in event) received.push(event.type)
        if (event.type === 'tool.completed') resolve()
      })
    )
    await client.create({
      goal: 'order',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    await complete
    expect(received).toEqual([
      'request.accepted',
      'response.start',
      'activity.started',
      'tool.completed'
    ])
  })

  it('uses an expired-history snapshot as a new cursor high-water mark', async () => {
    const wsUrl = await listen()
    server!.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; requestId?: string }
        if (frame.type === 'auth')
          send(socket, {
            type: 'session.ready',
            protocol: 'action-driver.stream.v2',
            eventId: 'ready-snapshot',
            connectionId: 'connection-1',
            capabilities: ['request.create'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        if (frame.type === 'request.create') {
          const requestId = frame.requestId!
          send(socket, {
            type: 'request.accepted',
            ...identity,
            requestId,
            eventId: 'accepted-snapshot',
            cursor: 1,
            sequence: 0,
            occurredAt: '2026-09-23T00:00:01.000Z'
          })
          send(socket, {
            type: 'activity.completed',
            ...identity,
            requestId,
            eventId: 'after-snapshot',
            cursor: 8,
            sequence: 4,
            occurredAt: '2026-09-23T00:00:08.000Z',
            activityId: 'activity-snapshot'
          })
          send(socket, {
            type: 'response.snapshot',
            ...identity,
            requestId,
            eventId: 'snapshot-high-water',
            cursor: 6,
            occurredAt: '2026-09-23T00:00:06.000Z',
            sequence: 2,
            status: 'running',
            messages: [],
            activities: [],
            activityTimeline: [],
            error: null
          })
          send(socket, {
            type: 'activity.started',
            ...identity,
            requestId,
            eventId: 'before-completed',
            cursor: 7,
            sequence: 3,
            occurredAt: '2026-09-23T00:00:07.000Z',
            activityId: 'activity-snapshot',
            title: '读取文件',
            titleRevision: 1
          })
          send(socket, {
            type: 'activity.started',
            ...identity,
            requestId,
            eventId: 'duplicate-old',
            cursor: 5,
            sequence: 1,
            occurredAt: '2026-09-23T00:00:05.000Z',
            activityId: 'old',
            title: '旧标题',
            titleRevision: 1
          })
        }
      })
    })
    client = new RendererStreamClient({
      getConnection: async () => ({
        wsUrl,
        protocol: 'action-driver.stream.v2',
        accessToken: 'token'
      }),
      createWebSocket: (url, protocols) => new WebSocket(url, protocols)
    })
    const received: string[] = []
    const completed = new Promise<void>((resolve) =>
      client!.subscribe((event) => {
        if ('cursor' in event) received.push(`${event.type}:${event.cursor}`)
        if (event.type === 'activity.completed') resolve()
      })
    )
    await client.create({
      goal: 'snapshot',
      model: { connectionId: 'connection-1', modelId: 'gpt-real' }
    })
    await Promise.race([
      completed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('snapshot stalled')), 500))
    ])
    expect(received).toEqual([
      'request.accepted:1',
      'response.snapshot:6',
      'activity.started:7',
      'activity.completed:8'
    ])
  })

  it('resumes a restored running request from its cursor and accepts later content', async () => {
    const wsUrl = await listen()
    const frames: Array<{ type: string; afterCursor?: number }> = []
    server!.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; afterCursor?: number }
        frames.push(frame)
        if (frame.type === 'auth') {
          send(socket, {
            type: 'session.ready',
            protocol: 'action-driver.stream.v2',
            eventId: 'ready-restored',
            connectionId: 'connection-1',
            capabilities: ['request.resume'],
            occurredAt: '2026-09-23T00:00:00.000Z'
          })
        }
        if (frame.type === 'request.resume') {
          send(socket, {
            type: 'response.content',
            ...identity,
            eventId: 'content-restored',
            cursor: 6,
            sequence: 3,
            occurredAt: '2026-09-23T00:00:06.000Z',
            delta: '继续',
            contentIndex: 0
          })
        }
      })
    })
    client = new RendererStreamClient({
      getConnection: async () => ({
        wsUrl,
        protocol: 'action-driver.stream.v2',
        accessToken: 'token'
      }),
      createWebSocket: (url, protocols) => new WebSocket(url, protocols)
    })
    const content = new Promise<void>((resolve) =>
      client!.subscribe((event) => {
        if (event.type === 'response.content') resolve()
      })
    )
    await client.watchExisting({
      requestId: identity.requestId,
      responseId: identity.responseId,
      taskId: identity.taskId,
      cursor: 5,
      sequence: 2
    })
    await Promise.race([
      content,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('restored content stalled')), 500)
      )
    ])
    await client.cancel(identity.taskId)
    expect(frames).toContainEqual(
      expect.objectContaining({ type: 'request.resume', afterCursor: 5 })
    )
    await vi.waitFor(() =>
      expect(frames).toContainEqual(expect.objectContaining({ type: 'request.cancel' }))
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
        protocol: 'action-driver.stream.v2',
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
