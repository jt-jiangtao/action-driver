import type {
  InteractionLogDetail,
  InteractionLogQuery,
  InteractionLogSummary
} from '@actiondriver/observability'

export type LogDirection = 'renderer->service' | 'service->renderer' | 'service->skill'

export interface InteractionLogRecord {
  id?: string
  correlationId?: string
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
  requestBytes?: number
  responseBytes?: number
  requestAvailable?: boolean
  responseAvailable?: boolean
  requestTruncated?: boolean
  responseTruncated?: boolean
  completedAt?: number | null
  kind?: InteractionLogSummary['kind']
  state?: InteractionLogSummary['state']
}

export type InteractionLogRequest = InteractionLogQuery

export interface InteractionLogResult {
  records: InteractionLogRecord[]
  nextCursor?: string | null
  files: string[]
}

export interface InteractionLogService {
  list(request: InteractionLogRequest): Promise<InteractionLogResult>
  detail?(eventId: string): Promise<InteractionLogDetail>
}
