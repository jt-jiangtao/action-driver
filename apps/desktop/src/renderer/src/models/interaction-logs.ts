export type LogDirection = 'renderer->service' | 'service->renderer' | 'service->skill'

export interface InteractionLogRecord {
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

export interface InteractionLogRequest {
  level?: string
  direction?: string
  search?: string
  limit?: number
}

export interface InteractionLogResult {
  records: InteractionLogRecord[]
  files: string[]
}

export interface InteractionLogService {
  list(request: InteractionLogRequest): Promise<InteractionLogResult>
}
