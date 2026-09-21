import type { Logger } from 'pino'

export type InteractionTransport = 'http' | 'websocket' | 'ipc'
export type InteractionDirection = 'renderer->service' | 'service->renderer' | 'service->skill'

export type InteractionStart = {
  transport: InteractionTransport
  direction: InteractionDirection
  /** HTTP method, WebSocket message type or IPC channel. */
  operation: string
  requestId?: string
  taskId?: string
  /** Non sensitive routing details such as protocol or connection id. */
  context?: Record<string, string | number | boolean | undefined>
}

export type InteractionResult = {
  outcome: string
  status?: number
  payload?: unknown
  error?: { code: string; message: string }
}

export type InteractionRecord = {
  transport: InteractionTransport
  direction: InteractionDirection
  operation: string
  requestId?: string
  taskId?: string
  outcome: string
  status?: number
  durationMs: number
  payloadBytes?: number
  payloadItems?: number
  context?: InteractionStart['context']
  errorCode?: string
  errorMessage?: string
}

export type InteractionLogger = {
  start(entry: InteractionStart): (result: InteractionResult) => InteractionRecord
  /** Records an interaction that completed immediately (for example a rejected message). */
  record(entry: InteractionStart, result: InteractionResult, durationMs?: number): InteractionRecord
}

/**
 * Summarises a payload for logging without ever writing its contents: only the encoded size and the
 * number of list items are recorded.
 */
export function summarizePayload(payload: unknown): {
  payloadBytes?: number
  payloadItems?: number
} {
  if (payload === undefined || payload === null) return {}
  if (Array.isArray(payload)) {
    return { payloadBytes: byteLength(payload), payloadItems: payload.length }
  }
  return { payloadBytes: byteLength(payload) }
}

export function createInteractionLogger(logger: Logger): InteractionLogger {
  const emit = (record: InteractionRecord): InteractionRecord => {
    const level = record.errorCode ? 'error' : 'info'
    logger[level](record, `${record.direction} ${record.operation} ${record.outcome}`)
    return record
  }

  return {
    start(entry) {
      const startedAt = Date.now()
      return (result) => emit(buildRecord(entry, result, Date.now() - startedAt))
    },
    record(entry, result, durationMs = 0) {
      return emit(buildRecord(entry, result, durationMs))
    }
  }
}

function buildRecord(
  entry: InteractionStart,
  result: InteractionResult,
  durationMs: number
): InteractionRecord {
  return {
    transport: entry.transport,
    direction: entry.direction,
    operation: entry.operation,
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.taskId ? { taskId: entry.taskId } : {}),
    outcome: result.outcome,
    ...(result.status === undefined ? {} : { status: result.status }),
    durationMs,
    ...summarizePayload(result.payload),
    ...(entry.context ? { context: entry.context } : {}),
    ...(result.error ? { errorCode: result.error.code, errorMessage: result.error.message } : {})
  }
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return 0
  }
}
