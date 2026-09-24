import type { LogDetailResult, LogListRequest, LogListResult } from '../../../shared/log-ipc-contract'
import type {
  InteractionLogRecord,
  InteractionLogRequest,
  InteractionLogResult,
  InteractionLogService
} from '../models/interaction-logs'
import type { InteractionLogDetail } from '@actiondriver/observability'

export class DesktopInteractionLogService implements InteractionLogService {
  constructor(private readonly api: {
    list(request: LogListRequest): Promise<LogListResult>
    detail(eventId: string): Promise<LogDetailResult>
  }) {}

  async list(request: InteractionLogRequest): Promise<InteractionLogResult> {
    const result = await this.api.list(request)
    return {
      records: result.records.map((record) => ({ ...record }) as InteractionLogRecord),
      nextCursor: result.nextCursor,
      files: [...result.files]
    }
  }

  detail(eventId: string): Promise<InteractionLogDetail> {
    return this.api.detail(eventId)
  }
}

/** Deterministic fixtures for component and visual runs. */
export class MockInteractionLogService implements InteractionLogService {
  constructor(private readonly seed: InteractionLogRecord[] = defaultRecords()) {}

  async list(request: InteractionLogRequest): Promise<InteractionLogResult> {
    return {
      records: this.seed.filter((record) => {
        if (request.direction && record.direction !== request.direction) return false
        if (
          request.search &&
          !JSON.stringify(record).toLowerCase().includes(request.search.toLowerCase())
        )
          return false
        return true
      }),
      files: ['~/Library/Application Support/ActionDriver/logs/renderer-service.log']
    }
  }

  async detail(eventId: string): Promise<InteractionLogDetail> {
    const record = this.seed.find((candidate) => keyOf(candidate) === eventId)
    if (!record) throw new Error('Interaction event was not found')
    return {
      id: record.id ?? eventId,
      correlationId: record.correlationId ?? eventId,
      time: record.time,
      completedAt: record.completedAt ?? record.time,
      transport: (record.transport ?? 'ipc') as InteractionLogDetail['transport'],
      direction: (record.direction ?? 'renderer->service') as InteractionLogDetail['direction'],
      kind: record.kind ?? 'request-response',
      state: record.state ?? 'completed',
      operation: record.operation ?? 'unknown',
      level: record.level,
      levelLabel: record.levelLabel,
      ...(record.outcome ? { outcome: record.outcome } : {}),
      ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
      requestBytes: record.requestBytes ?? record.payloadBytes ?? 0,
      responseBytes: record.responseBytes ?? 0,
      requestAvailable: record.requestAvailable ?? false,
      responseAvailable: record.responseAvailable ?? false,
      requestTruncated: record.requestTruncated ?? false,
      responseTruncated: record.responseTruncated ?? false,
      request: null,
      response: null
    }
  }
}

function keyOf(record: InteractionLogRecord): string {
  return record.id ?? `${record.time}:${record.operation ?? record.msg ?? ''}`
}

function defaultRecords(): InteractionLogRecord[] {
  const base = Date.parse('2026-09-22T02:20:00.000Z')
  return [
    {
      level: 30,
      levelLabel: 'info',
      time: base,
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'actiondriver:model-connections:list',
      outcome: 'ok',
      durationMs: 12,
      payloadBytes: 1738,
      payloadItems: 2
    },
    {
      level: 30,
      levelLabel: 'info',
      time: base + 1_000,
      transport: 'http',
      direction: 'renderer->service',
      operation: 'POST /model-connections/test',
      outcome: 'ok',
      status: 200,
      durationMs: 842
    },
    {
      level: 40,
      levelLabel: 'warn',
      time: base + 2_000,
      transport: 'http',
      direction: 'renderer->service',
      operation: 'GET /model-connections',
      outcome: 'rejected',
      status: 403,
      durationMs: 1,
      errorCode: 'unauthorized'
    }
  ]
}
