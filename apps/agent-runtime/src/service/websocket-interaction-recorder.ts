import type { InteractionLogRecorder } from '@actiondriver/observability'

export type WebSocketMessage = {
  type: string
  requestId?: string
  taskId?: string
  payload: unknown
}

export interface WebSocketInteractionRecorder {
  startCommand(message: WebSocketMessage): Promise<(response: WebSocketMessage) => Promise<void>>
  recordEvent(message: WebSocketMessage): Promise<void>
}

/**
 * Transport-neutral adapter for the planned WebSocket service. Real socket call-site wiring belongs
 * to OpenSpec tasks 3.1–3.7 once that service exists; keeping the adapter independent prevents a
 * future protocol implementation from inventing a second logging contract.
 */
export function createWebSocketInteractionRecorder(
  interactions: InteractionLogRecorder
): WebSocketInteractionRecorder {
  return {
    async startCommand(message) {
      const finish = await interactions.start({
        transport: 'websocket',
        direction: 'renderer->service',
        operation: message.type,
        ...(message.requestId ? { requestId: message.requestId } : {}),
        ...(message.taskId ? { taskId: message.taskId } : {}),
        request: { kind: 'json', value: message }
      })
      return async (response) => {
        await finish({
          outcome: 'ok',
          response: { kind: 'json', value: response }
        })
      }
    },
    async recordEvent(message) {
      await interactions.recordOneWay({
        transport: 'websocket',
        direction: 'service->renderer',
        operation: message.type,
        ...(message.requestId ? { requestId: message.requestId } : {}),
        ...(message.taskId ? { taskId: message.taskId } : {}),
        payload: { kind: 'json', value: message }
      })
    }
  }
}
