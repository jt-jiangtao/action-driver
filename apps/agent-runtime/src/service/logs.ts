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

const DEFAULT_LIMIT = 200
const DEFAULT_MAX_BYTES = 512 * 1024

/**
 * Reads the newest log records from a JSON line log file. Only the tail of the file is read so a
 * long running session never loads the whole file just to show recent interactions.
 */
export function readRecentLogRecords(options: ReadLogOptions): LogRecord[] {
  if (!existsSync(options.filePath)) return []
  const limit = options.limit ?? DEFAULT_LIMIT
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const size = statSync(options.filePath).size
  const contents = readFileSync(options.filePath, 'utf8')
  const slice = size > maxBytes ? contents.slice(Math.max(0, contents.length - maxBytes)) : contents
  const lines = slice.split('\n').filter((line) => line.trim())
  const records: LogRecord[] = []
  for (const line of lines) {
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

export const LOG_LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
}
