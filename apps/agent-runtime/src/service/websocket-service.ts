import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { Logger } from 'pino'
import { WebSocket, WebSocketServer } from 'ws'
import {
  STREAM_PROTOCOL,
  parseStreamClientEvent,
  type StreamClientEvent,
  type StreamServerEvent
} from '@actiondriver/runtime-contracts'

export const SERVICE_STREAM_PATH = '/stream' as const
export const SERVICE_STREAM_PROTOCOL = STREAM_PROTOCOL

export type ServiceStreamSessionPort = {
  handle(
    event: StreamClientEvent,
    emit: (event: StreamServerEvent) => void | Promise<void>
  ): Promise<void>
  close?(): Promise<void>
}

export function attachServiceWebSocketServer(
  server: Server,
  options: {
    sessions: ServiceStreamSessionPort
    tokenMatches(token: string): boolean
    logger: Logger | null
    trustedRendererOrigins?: readonly string[]
    maxPayloadBytes?: number
    maxBufferedBytes?: number
  }
): { close(): Promise<void> } {
  const maxPayloadBytes = options.maxPayloadBytes ?? 1_000_000
  const maxBufferedBytes = options.maxBufferedBytes ?? 1_000_000
  const trustedRendererOrigins = new Set(options.trustedRendererOrigins ?? [])
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const origin = request.headers.origin
    const trustedRendererOrigin =
      origin === undefined || origin === 'file://' || trustedRendererOrigins.has(origin)
    if (url.pathname !== SERVICE_STREAM_PATH || !trustedRendererOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request)
    })
  })

  webSockets.on('connection', (webSocket, request) => {
    webSocket.on('error', (error) => {
      options.logger?.debug(
        {
          transport: 'websocket',
          code: 'code' in error ? error.code : undefined,
          message: error.message
        },
        'websocket closed after protocol error'
      )
    })
    if (request.headers['sec-websocket-protocol'] !== SERVICE_STREAM_PROTOCOL) {
      webSocket.close(1002, 'Required WebSocket subprotocol was not selected')
      return
    }

    const connectionId = randomUUID()
    let authenticated = false
    const send = async (event: StreamServerEvent) => {
      if (webSocket.readyState !== WebSocket.OPEN) return
      const serialized = JSON.stringify(event)
      if (webSocket.bufferedAmount + Buffer.byteLength(serialized) > maxBufferedBytes) {
        webSocket.close(1013, 'Client cannot keep up with the stream')
        return
      }
      webSocket.send(serialized)
    }

    webSocket.on('message', (data, isBinary) => {
      void (async () => {
        if (isBinary) {
          webSocket.close(authenticated ? 1002 : 1008, 'Binary messages are not supported')
          return
        }
        let event: StreamClientEvent
        try {
          event = parseStreamClientEvent(JSON.parse(data.toString()) as unknown)
        } catch {
          webSocket.close(
            authenticated ? 1002 : 1008,
            authenticated ? 'Invalid stream message' : 'Valid authentication is required'
          )
          return
        }

        if (!authenticated) {
          if (event.type !== 'auth' || !options.tokenMatches(event.payload.token)) {
            webSocket.close(1008, 'Unauthorized')
            return
          }
          authenticated = true
          await send({
            type: 'session.ready',
            protocol: SERVICE_STREAM_PROTOCOL,
            eventId: randomUUID(),
            connectionId,
            capabilities: ['request.create', 'request.cancel', 'request.resume', 'tool.approve', 'tool.reject'],
            occurredAt: new Date().toISOString()
          })
          return
        }

        if (event.type === 'auth') {
          webSocket.close(1002, 'Already authenticated')
          return
        }
        try {
          await options.sessions.handle(event, send)
        } catch (error) {
          options.logger?.error(
            {
              transport: 'websocket',
              connectionId,
              message: error instanceof Error ? error.message : String(error)
            },
            'stream command failed'
          )
          if ('requestId' in event) {
            await send({
              type: 'request.error',
              protocol: SERVICE_STREAM_PROTOCOL,
              eventId: randomUUID(),
              requestId: event.requestId,
              error: {
                code: 'stream-command-failed',
                message: error instanceof Error ? error.message : String(error),
                retryable: false
              },
              occurredAt: new Date().toISOString()
            })
          }
        }
      })()
    })
  })

  return {
    close: async () => {
      await options.sessions.close?.()
      for (const client of webSockets.clients) client.close(1001, 'Service shutting down')
      await new Promise<void>((resolve) => webSockets.close(() => resolve()))
    }
  }
}
