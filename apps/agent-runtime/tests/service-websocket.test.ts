import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { StreamClientEvent, StreamServerEvent } from '@actiondriver/runtime-contracts'
import {
  createInteractionLogRecorder,
  MemoryInteractionLogStore
} from '@actiondriver/observability'
import {
  startServiceHttpServer,
  type ServiceHttpServer,
  type ServiceStreamSessionPort
} from '../src/service/http-service'

let server: ServiceHttpServer | undefined
let socket: WebSocket | undefined

afterEach(async () => {
  socket?.close()
  socket = undefined
  await server?.close()
  server = undefined
})

function serviceStub() {
  return {
    async list() {
      return []
    },
    async testConnection() {
      return { ok: true as const }
    },
    async discover() {
      return []
    },
    async refresh() {
      return []
    },
    async testModels() {
      return []
    },
    async testConnectionModels() {
      return []
    },
    async setModelEnabled() {},
    async add() {
      throw new Error('not used')
    },
    async delete() {}
  }
}

function nextMessage(ws: WebSocket): Promise<StreamServerEvent> {
  return new Promise((resolve, reject) => {
    ws.once('error', reject)
    ws.once('message', (data) => resolve(JSON.parse(data.toString()) as StreamServerEvent))
  })
}

function nextMessages(ws: WebSocket, count: number): Promise<StreamServerEvent[]> {
  return new Promise((resolve, reject) => {
    const messages: StreamServerEvent[] = []
    ws.once('error', reject)
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as StreamServerEvent)
      if (messages.length === count) resolve(messages)
    })
  })
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
}

function auth(ws: WebSocket, token = 'service-token'): void {
  ws.send(
    JSON.stringify({
      type: 'auth',
      protocol: 'actiondriver.stream.v1',
      eventId: 'client-auth-1',
      createdAt: '2026-09-23T00:00:00.000Z',
      payload: { token }
    })
  )
}

describe('service WebSocket surface', () => {
  it('requires authentication before forwarding tool decisions and advertises approval support', async () => {
    const handle = vi.fn(async () => undefined)
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { handle },
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, ['actiondriver.stream.v1'])
    await waitForOpen(socket)
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({
      type: 'tool.approve', protocol: 'actiondriver.stream.v1', eventId: 'decision-1',
      createdAt: '2026-09-23T00:00:00.000Z', requestId: 'request-1', taskId: 'task-1',
      callId: 'call-1', argumentsHash: 'sha256:abc'
    }))
    await expect(closed).resolves.toMatchObject({ code: 1008 })
    expect(handle).not.toHaveBeenCalled()

    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, ['actiondriver.stream.v1'])
    await waitForOpen(socket)
    const ready = nextMessage(socket)
    auth(socket)
    await expect(ready).resolves.toMatchObject({
      type: 'session.ready',
      capabilities: expect.arrayContaining(['tool.approve', 'tool.reject'])
    })
  })
  it('accepts the Electron file origin and rejects ordinary browser origins', async () => {
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {} },
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(
      `${server.url.replace('http:', 'ws:')}/stream`,
      ['actiondriver.stream.v1'],
      { origin: 'file://' }
    )
    await waitForOpen(socket)
    const ready = nextMessage(socket)
    auth(socket)
    await expect(ready).resolves.toMatchObject({ type: 'session.ready' })
    socket.close()

    socket = new WebSocket(
      `${server.url.replace('http:', 'ws:')}/stream`,
      ['actiondriver.stream.v1'],
      { origin: 'https://untrusted.example' }
    )
    await expect(waitForOpen(socket)).rejects.toThrow('Unexpected server response: 403')
  })

  it('accepts only an explicitly configured development renderer origin', async () => {
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {} },
      token: 'service-token',
      runtimeVersion: '0.1.0',
      trustedRendererOrigins: ['http://localhost:5173']
    })
    socket = new WebSocket(
      `${server.url.replace('http:', 'ws:')}/stream`,
      ['actiondriver.stream.v1'],
      { origin: 'http://localhost:5173' }
    )
    await waitForOpen(socket)
    socket.close()

    socket = new WebSocket(
      `${server.url.replace('http:', 'ws:')}/stream`,
      ['actiondriver.stream.v1'],
      { origin: 'http://localhost:5174' }
    )
    await expect(waitForOpen(socket)).rejects.toThrow('Unexpected server response: 403')
  })

  it('authenticates once and forwards stream commands over the same native WebSocket', async () => {
    const received: StreamClientEvent[] = []
    const sessions: ServiceStreamSessionPort = {
      async handle(event, emit) {
        received.push(event)
        if (event.type !== 'request.resume') return
        await emit({
          type: 'request.error',
          protocol: 'actiondriver.stream.v1',
          eventId: 'server-event-1',
          requestId: event.requestId,
          error: { code: 'request-not-found', message: 'Unknown request', retryable: false },
          occurredAt: '2026-09-23T00:00:00.000Z'
        })
      }
    }
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: sessions,
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)

    let message = nextMessage(socket)
    auth(socket)
    await expect(message).resolves.toMatchObject({
      type: 'session.ready',
      protocol: 'actiondriver.stream.v1'
    })

    message = nextMessage(socket)
    socket.send(
      JSON.stringify({
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-resume-1',
        createdAt: '2026-09-23T00:00:01.000Z',
        requestId: 'missing-request',
        afterCursor: 0
      })
    )
    await expect(message).resolves.toMatchObject({
      type: 'request.error',
      requestId: 'missing-request'
    })
    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe('request.resume')
  })

  it.each([
    { label: 'missing', protocols: undefined },
    { label: 'wrong', protocols: ['wrong.protocol'] }
  ])('closes a $label WebSocket subprotocol with 1002', async ({ protocols }) => {
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {} },
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = protocols
      ? new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, protocols)
      : new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`)
    const closed = waitForClose(socket)
    await waitForOpen(socket)

    await expect(closed).resolves.toMatchObject({ code: 1002 })
  })

  it('uses policy close 1008 for invalid auth and protocol close 1002 after auth', async () => {
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {} },
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    let closed = waitForClose(socket)
    socket.send(JSON.stringify({ type: 'request.resume' }))
    await expect(closed).resolves.toMatchObject({ code: 1008 })

    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    const message = nextMessage(socket)
    auth(socket)
    await message
    closed = waitForClose(socket)
    socket.send(JSON.stringify({ type: 'unknown', protocol: 'actiondriver.stream.v1' }))
    await expect(closed).resolves.toMatchObject({ code: 1002 })
  })

  it('closes oversized JSON with 1009 before parsing it', async () => {
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {} },
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({ type: 'auth', payload: { token: 'x'.repeat(1_000_001) } }))

    await expect(closed).resolves.toMatchObject({ code: 1009 })
  })

  it('uses native ping/pong and never records the authentication token', async () => {
    const store = new MemoryInteractionLogStore()
    const interactions = createInteractionLogRecorder({
      store,
      ids: { eventId: () => 'event-1', correlationId: () => 'correlation-1' },
      clock: () => 1_000
    })
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {} },
      token: 'service-token',
      runtimeVersion: '0.1.0',
      interactions
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    const ready = nextMessage(socket)
    auth(socket)
    await ready
    const pong = new Promise<void>((resolve) => socket!.once('pong', () => resolve()))
    socket.ping('health')
    await pong

    expect(JSON.stringify(await store.list({ limit: 20 }))).not.toContain('service-token')
  })

  it('preserves accepted/start/content/end order for one create command', async () => {
    const sessions: ServiceStreamSessionPort = {
      async handle(event, emit) {
        if (event.type !== 'request.create') return
        if (event.sessionId !== null) throw new Error('expected a new-session request')
        const identity = {
          protocol: 'actiondriver.stream.v1' as const,
          requestId: event.requestId,
          sessionId: 'session-1',
          taskId: 'task-1',
          responseId: 'response-1',
          streamId: 'stream-1',
          messageId: 'message-1'
        }
        await emit({
          type: 'request.accepted',
          ...identity,
          eventId: 'event-accepted',
          cursor: 1,
          occurredAt: '2026-09-23T00:00:01.000Z'
        })
        await emit({
          type: 'response.start',
          ...identity,
          eventId: 'event-start',
          cursor: 2,
          occurredAt: '2026-09-23T00:00:02.000Z',
          sequence: 0,
          model: event.payload.model
        })
        await emit({
          type: 'response.content',
          ...identity,
          eventId: 'event-content',
          cursor: 3,
          occurredAt: '2026-09-23T00:00:03.000Z',
          sequence: 1,
          delta: 'real',
          contentIndex: 0
        })
        await emit({
          type: 'response.end',
          ...identity,
          eventId: 'event-end',
          cursor: 4,
          occurredAt: '2026-09-23T00:00:04.000Z',
          sequence: 2,
          status: 'completed',
          content: 'real',
          finishReason: 'stop',
          usage: null,
          durationMs: 3,
          error: null
        })
      }
    }
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: sessions,
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    let messages = nextMessages(socket, 1)
    auth(socket)
    await messages
    messages = nextMessages(socket, 4)
    socket.send(
      JSON.stringify({
        type: 'request.create',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-create',
        createdAt: '2026-09-23T00:00:00.000Z',
        requestId: 'request-1',
        idempotencyKey: 'idempotency-1',
        sessionId: null,
        payload: {
          input: { role: 'user', content: 'hello' },
          model: { connectionId: 'connection-1', modelId: 'gpt-real' },
          skills: []
        }
      })
    )

    await expect(messages).resolves.toSatisfy(
      (events: StreamServerEvent[]) =>
        events.map((event) => event.type).join(',') ===
        'request.accepted,response.start,response.content,response.end'
    )
  })

  it('closes a client with 1013 before queuing an oversized outbound event', async () => {
    const sessions: ServiceStreamSessionPort = {
      async handle(event, emit) {
        if (event.type !== 'request.resume') return
        await emit({
          type: 'request.error',
          protocol: 'actiondriver.stream.v1',
          eventId: 'event-large',
          requestId: event.requestId,
          error: { code: 'large', message: 'x'.repeat(1_000), retryable: false },
          occurredAt: '2026-09-23T00:00:00.000Z'
        })
      }
    }
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: sessions,
      token: 'service-token',
      runtimeVersion: '0.1.0',
      streamMaxBufferedBytes: 500
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    const ready = nextMessage(socket)
    auth(socket)
    await ready
    const closed = waitForClose(socket)
    socket.send(
      JSON.stringify({
        type: 'request.resume',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-resume-large',
        createdAt: '2026-09-23T00:00:01.000Z',
        requestId: 'request-1',
        afterCursor: 0
      })
    )

    await expect(closed).resolves.toMatchObject({ code: 1013 })
  })

  it('closes active sockets and the session service during shutdown', async () => {
    const closeSessions = vi.fn(async () => undefined)
    server = await startServiceHttpServer({
      service: serviceStub(),
      streamSessions: { async handle() {}, close: closeSessions },
      token: 'service-token',
      runtimeVersion: '0.1.0'
    })
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`, [
      'actiondriver.stream.v1'
    ])
    await waitForOpen(socket)
    const closed = waitForClose(socket)

    const shutdown = server.close()
    server = undefined
    await expect(closed).resolves.toMatchObject({ code: 1001 })
    await shutdown
    expect(closeSessions).toHaveBeenCalledOnce()
  })
})
