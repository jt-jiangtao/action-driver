export const LOG_IPC_CHANNELS = {
  list: 'actiondriver:logs:list'
} as const

export type LogRecordDto = {
  level: number
  levelLabel: string
  time: number
  name?: string
  msg?: string
  transport?: string
  direction?: string
  operation?: string
  outcome?: string
  status?: number
  durationMs?: number
  payloadBytes?: number
  payloadItems?: number
  errorCode?: string
  errorMessage?: string
}

export type LogListRequest = {
  level?: string
  direction?: string
  search?: string
  limit?: number
}

export type LogListResult = {
  records: LogRecordDto[]
  files: string[]
  readable: boolean
}

export type LogIpcResponse<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
