import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { pino, multistream, type Logger, type LoggerOptions } from 'pino'
import pretty from 'pino-pretty'
import { INTERACTION_REDACT_PATHS } from './redaction'

export type LoggerFactoryOptions = {
  name: string
  level?: string
  pretty?: boolean
  filePath?: string
  maxFileBytes?: number
}

export type ActionDriverLogger = {
  logger: Logger
  logFilePath: string | null
  close(): Promise<void>
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024

/**
 * Creates a logger for one ActionDriver process.
 *
 * Readable pretty lines go to stdout for developer runs; the same records are appended as JSON to
 * `filePath` so interactions stay inspectable when the process has no terminal. pino-pretty is used
 * as a synchronous stream (not a worker transport) so it also works inside an Electron utility
 * process. The file is rotated once it reaches `maxFileBytes` to bound long running sessions.
 */
export function createLogger(options: LoggerFactoryOptions): ActionDriverLogger {
  const prettyOutput =
    options.pretty ?? (process.env.ACTIONDRIVER_LOG_PRETTY !== '0' && process.env.NODE_ENV !== 'test')
  const base: LoggerOptions = {
    name: options.name,
    level: options.level ?? process.env.ACTIONDRIVER_LOG_LEVEL ?? 'info',
    redact: { paths: INTERACTION_REDACT_PATHS, censor: '[redacted]' }
  }

  const streams: { stream: NodeJS.WritableStream }[] = [
    { stream: prettyOutput ? createPrettyStream() : process.stdout }
  ]

  let logFilePath: string | null = null
  let fileStream: ReturnType<typeof createWriteStream> | null = null
  if (options.filePath) {
    logFilePath = options.filePath
    mkdirSync(dirname(logFilePath), { recursive: true })
    fileStream = createWriteStream(logFilePath, { flags: 'a' })
    rotateIfNeeded(logFilePath, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)
    streams.push({ stream: fileStream })
  }

  const logger = pino(base, multistream(streams, { dedupe: false }))

  return {
    logger,
    logFilePath,
    close: async () => {
      if (!fileStream) return
      const stream = fileStream
      fileStream = null
      await new Promise<void>((resolve) => stream.end(() => resolve()))
    }
  }
}

function createPrettyStream(): NodeJS.WritableStream {
  return pretty({
    colorize: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
    singleLine: true
  }) as unknown as NodeJS.WritableStream
}

function rotateIfNeeded(filePath: string, maxBytes: number): void {
  if (!existsSync(filePath)) return
  if (statSync(filePath).size < maxBytes) return
  renameSync(filePath, `${filePath}.1`)
}
