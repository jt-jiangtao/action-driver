import {
  LOG_LEVELS,
  logLevelLabel,
  readRecentLogRecords,
  type LogRecord
} from '@actiondriver/observability'
import type { InteractionLogRecorder } from '@actiondriver/observability'
import type {
  LogIpcResponse,
  LogListRequest,
  LogListResult,
  LogRecordDto
} from '../shared/log-ipc-contract'
import { LOG_IPC_CHANNELS } from '../shared/log-ipc-contract'
import { startIpcInteraction } from './logging'

export interface LogIpcMain {
  handle(channel: string, handler: (event: unknown, input: unknown) => unknown): void
}

export type LogSource = {
  filePath: string
}

/**
 * Serves the interaction log to the log page. Until the service HTTP surface owns this data, Main
 * reads the same files the service writes, so the page works in both assemblies.
 */
export function registerLogIpcHandlers(
  ipcMain: LogIpcMain,
  sources: LogSource[],
  interactions?: InteractionLogRecorder
): void {
  ipcMain.handle(LOG_IPC_CHANNELS.list, async (_event, input) => {
    const finish = await startIpcInteraction(interactions, LOG_IPC_CHANNELS.list, input)
    try {
      const value = readLogs(sources, (input ?? {}) as LogListRequest)
      await finish?.({ outcome: 'ok', response: { kind: 'json', value } })
      return { ok: true, value } satisfies LogIpcResponse<LogListResult>
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await finish?.({ outcome: 'error', error: { code: 'storage-error', message } })
      return {
        ok: false,
        error: { code: 'storage-error', message }
      } satisfies LogIpcResponse<LogListResult>
    }
  })
}

export function readLogs(sources: LogSource[], request: LogListRequest): LogListResult {
  const minLevel = request.level ? (LOG_LEVELS[request.level] ?? LOG_LEVELS.info!) : undefined
  const limit = request.limit && request.limit > 0 ? Math.min(request.limit, 1_000) : 200
  const records: LogRecordDto[] = []

  for (const source of sources) {
    for (const record of readRecentLogRecords({
      filePath: source.filePath,
      limit,
      ...(minLevel === undefined ? {} : { minLevel })
    })) {
      const dto = toDto(record)
      if (request.direction && dto.direction !== request.direction) continue
      if (request.search && !matchesSearch(dto, request.search)) continue
      records.push(dto)
    }
  }

  records.sort((left, right) => left.time - right.time)
  return {
    records: records.slice(-limit),
    files: sources.map((source) => source.filePath),
    readable: true
  }
}

function toDto(record: LogRecord): LogRecordDto {
  return {
    level: record.level,
    levelLabel: logLevelLabel(record.level),
    time: record.time,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.msg === 'string' ? { msg: record.msg } : {}),
    ...(typeof record.transport === 'string' ? { transport: record.transport } : {}),
    ...(typeof record.direction === 'string' ? { direction: record.direction } : {}),
    ...(typeof record.operation === 'string' ? { operation: record.operation } : {}),
    ...(typeof record.outcome === 'string' ? { outcome: record.outcome } : {}),
    ...(typeof record.status === 'number' ? { status: record.status } : {}),
    ...(typeof record.durationMs === 'number' ? { durationMs: record.durationMs } : {}),
    ...(typeof record.payloadBytes === 'number' ? { payloadBytes: record.payloadBytes } : {}),
    ...(typeof record.payloadItems === 'number' ? { payloadItems: record.payloadItems } : {}),
    ...(typeof record.errorCode === 'string' ? { errorCode: record.errorCode } : {}),
    ...(typeof record.errorMessage === 'string' ? { errorMessage: record.errorMessage } : {})
  }
}

function matchesSearch(record: LogRecordDto, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [record.operation, record.outcome, record.errorCode, record.msg, record.direction]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}
