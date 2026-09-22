import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { StreamClientEvent, StreamServerEvent } from '@actiondriver/runtime-contracts'
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

describe('service WebSocket surface', () => {
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
    socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/stream`)
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve)
      socket!.once('error', reject)
    })

    let message = nextMessage(socket)
    socket.send(
      JSON.stringify({
        type: 'auth',
        protocol: 'actiondriver.stream.v1',
        eventId: 'client-auth-1',
        createdAt: '2026-09-23T00:00:00.000Z',
        payload: { token: 'service-token' }
      })
    )
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
})
