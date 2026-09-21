import type { LogsDesktopApi } from '../../../preload/desktop-api'
import type {
  InteractionLogRecord,
  InteractionLogRequest,
  InteractionLogResult,
  InteractionLogService
} from '../models/interaction-logs'

export class DesktopInteractionLogService implements InteractionLogService {
  constructor(private readonly api: LogsDesktopApi) {}

  async list(request: InteractionLogRequest): Promise<InteractionLogResult> {
    const result = await this.api.list(request)
    return {
      records: result.records.map((record) => ({ ...record }) as InteractionLogRecord),
      files: [...result.files]
    }
  }
}

/** Deterministic fixtures for component and visual runs. */
export class MockInteractionLogService implements InteractionLogService {
  constructor(private readonly seed: InteractionLogRecord[] = defaultRecords()) {}

  async list(request: InteractionLogRequest): Promise<InteractionLogResult> {
    return {
      records: this.seed.filter((record) => {
        if (request.direction && record.direction !== request.direction) return false
        if (request.search && !JSON.stringify(record).toLowerCase().includes(request.search.toLowerCase()))
          return false
        return true
      }),
      files: ['~/Library/Application Support/ActionDriver/logs/renderer-service.log']
    }
  }
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
