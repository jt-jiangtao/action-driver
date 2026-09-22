import type {
  InteractionLogDetail,
  InteractionLogSummary,
  InteractionTransport
} from '@actiondriver/observability'

export const LOG_IPC_CHANNELS = {
  list: 'actiondriver:logs:list',
  detail: 'actiondriver:logs:detail'
} as const

export type LogListRequest = {
  level?: string
  direction?: string
  transports?: InteractionTransport[]
  search?: string
  cursor?: string | null
  limit?: number
}

export type LogListResult = {
  records: InteractionLogSummary[]
  nextCursor: string | null
  files: string[]
}

export type LogDetailRequest = { eventId: string }
export type LogDetailResult = InteractionLogDetail

export type LogIpcResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
