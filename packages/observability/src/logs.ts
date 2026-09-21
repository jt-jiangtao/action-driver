import { existsSync, readFileSync, statSync } from 'node:fs'

export type LogRecord = {
  level: number
  time: number
  name?: string
  msg?: string
  [key: string]: unknown
}

export type ReadLogOptions = {
  filePath: string
  limit?: number
  minLevel?: number
  maxBytes?: number
}

export type LogFileRequest = {
  filePath: string
  limit?: number
  minLevel?: number
  direction?: string
}

const DEFAULT_LIMIT = 200
const DEFAULT_MAX_BYTES = 512 * 1024

export const LOG_LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
}

export function logLevelLabel(level: number): string {
  const entry = Object.entries(LOG_LEVELS).find(([, value]) => value === level)
  return entry ? entry[0] : `level-${level}`
}

/**
 * Reads the newest records from a JSON line log file. Only the tail of the file is read so a long
 * running session never loads the whole file just to show recent interactions.
 */
export function readRecentLogRecords(options: ReadLogOptions): LogRecord[] {
  if (!existsSync(options.filePath)) return []
  const limit = options.limit ?? DEFAULT_LIMIT
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const size = statSync(options.filePath).size
  const contents = readFileSync(options.filePath, 'utf8')
  const slice = size > maxBytes ? contents.slice(Math.max(0, contents.length - maxBytes)) : contents
  const records: LogRecord[] = []
  for (const line of slice.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as LogRecord
      if (typeof parsed.level !== 'number') continue
      if (options.minLevel !== undefined && parsed.level < options.minLevel) continue
      records.push(parsed)
    } catch {
      // A rotated or partially written line is skipped rather than failing the whole read.
    }
  }
  return records.slice(-limit)
}

/** Merges several log files into one newest-last view for the log page. */
export function readMergedLogRecords(requests: LogFileRequest[]): LogRecord[] {
  const merged: LogRecord[] = []
  for (const request of requests) {
    for (const record of readRecentLogRecords({
      filePath: request.filePath,
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(request.minLevel === undefined ? {} : { minLevel: request.minLevel })
    })) {
      if (request.direction && record.direction !== request.direction) continue
      merged.push(record)
    }
  }
  return merged.sort((left, right) => left.time - right.time)
}
