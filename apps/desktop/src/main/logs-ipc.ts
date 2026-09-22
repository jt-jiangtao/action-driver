import type {
  InteractionLogRecorder,
  InteractionLogStore,
  InteractionLogSummary
} from '@actiondriver/observability'
import type {
  LogDetailRequest,
  LogDetailResult,
  LogIpcResponse,
  LogListRequest,
  LogListResult
} from '../shared/log-ipc-contract'
import { LOG_IPC_CHANNELS } from '../shared/log-ipc-contract'

export interface LogIpcMain {
  handle(channel: string, handler: (event: unknown, input: unknown) => unknown): void
}

export type LogSource = {
  prefix: 'main' | 'service'
  filePath: string
  store(): Promise<InteractionLogStore>
}

export function registerLogIpcHandlers(
  ipcMain: LogIpcMain,
  sources: LogSource[],
  interactions?: InteractionLogRecorder
): void {
  void interactions
  ipcMain.handle(LOG_IPC_CHANNELS.list, async (_event, input) => {
    try {
      const value = await listLogs(sources, (input ?? {}) as LogListRequest)
      return { ok: true, value } satisfies LogIpcResponse<LogListResult>
    } catch (error) {
      return failure('storage-error', error)
    }
  })

  ipcMain.handle(LOG_IPC_CHANNELS.detail, async (_event, input) => {
    const eventId = (input as LogDetailRequest | undefined)?.eventId
    const source = sources.find((candidate) => eventId?.startsWith(`${candidate.prefix}:`))
    if (!eventId || !source) {
      return failure('invalid-event-id', new Error('Unknown interaction event source'))
    }
    try {
      const detail = await (await source.store()).getDetail(eventId)
      if (!detail) return failure('not-found', new Error('Interaction event was not found'))
      return { ok: true, value: detail } satisfies LogIpcResponse<LogDetailResult>
    } catch (error) {
      return failure('storage-error', error)
    }
  })
}

export async function listLogs(
  sources: LogSource[],
  request: LogListRequest
): Promise<LogListResult> {
  const records = (
    await Promise.all(
      sources.map(async (source) => collectSummaries(await source.store(), request))
    )
  )
    .flat()
    .sort((left, right) => right.time - left.time || right.id.localeCompare(left.id))
  const after = decodeCursor(request.cursor)
  const eligible = after
    ? records.filter(
        (record) => record.time < after.time || (record.time === after.time && record.id < after.id)
      )
    : records
  const limit = Math.max(1, Math.min(request.limit ?? 200, 1_000))
  const page = eligible.slice(0, limit)
  return {
    records: page,
    nextCursor:
      page.length < eligible.length
        ? encodeCursor(page[page.length - 1] as InteractionLogSummary)
        : null,
    files: sources.map((source) => source.filePath)
  }
}

async function collectSummaries(
  store: InteractionLogStore,
  request: LogListRequest
): Promise<InteractionLogSummary[]> {
  const records: InteractionLogSummary[] = []
  let cursor: string | null = null
  do {
    const page = await store.list({
      ...(request.level ? { level: request.level } : {}),
      ...(request.direction ? { direction: request.direction } : {}),
      ...(request.transports ? { transports: request.transports } : {}),
      ...(request.search ? { search: request.search } : {}),
      cursor,
      limit: 1_000
    })
    records.push(...page.records)
    cursor = page.nextCursor
  } while (cursor)
  return records
}

function encodeCursor(record: Pick<InteractionLogSummary, 'time' | 'id'>): string {
  return Buffer.from(JSON.stringify({ time: record.time, id: record.id }), 'utf8').toString(
    'base64url'
  )
}

function decodeCursor(cursor: string | null | undefined): { time: number; id: string } | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      time?: unknown
      id?: unknown
    }
    return typeof value.time === 'number' && typeof value.id === 'string'
      ? { time: value.time, id: value.id }
      : null
  } catch {
    return null
  }
}

function failure<T>(code: string, error: unknown): LogIpcResponse<T> {
  return {
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error) }
  }
}
