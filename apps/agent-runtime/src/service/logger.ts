import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { pino, multistream, type Logger, type LoggerOptions } from 'pino'
import pretty from 'pino-pretty'

/** Never let credentials reach an interaction log, in any nesting depth. */
export const REDACTED_LOG_PATHS = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  '["x-api-key"]',
  'headers["x-api-key"]',
  'apiKey',
  '*.apiKey',
  'body.apiKey',
  'draft.apiKey',
  'apiKeyCipher',
  '*.apiKeyCipher',
  'token',
  '*.token'
]

export type ServiceLoggerOptions = {
  level?: string
  pretty?: boolean
  databasePath?: string
  name?: string
}

export type ServiceLogger = {
  logger: Logger
  logFilePath: string | null
  close(): Promise<void>
}

/**
 * Creates the service logger.
 *
 * Readable pretty lines go to stdout for developer runs; the same records are appended as JSON to
 * `<userData>/logs/service.log` so the interactions remain inspectable when the app is launched
 * without a terminal. pino-pretty is used as a synchronous stream instead of a worker transport so
 * it also works inside an Electron utility process.
 */
export function createServiceLogger(options: ServiceLoggerOptions = {}): ServiceLogger {
  const level = options.level ?? process.env.ACTIONDRIVER_LOG_LEVEL ?? 'info'
  const prettyOutput =
    options.pretty ?? (process.env.ACTIONDRIVER_LOG_PRETTY !== '0' && process.env.NODE_ENV !== 'test')
  const base: LoggerOptions = {
    name: options.name ?? 'actiondriver-service',
    level,
    redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' }
  }

  const streams: { stream: NodeJS.WritableStream }[] = []
  streams.push({
    stream: prettyOutput
      ? (pretty({
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: true
        }) as unknown as NodeJS.WritableStream)
      : process.stdout
  })

  let logFilePath: string | null = null
  let fileStream: WriteStream | null = null
  if (options.databasePath) {
    logFilePath = join(dirname(options.databasePath), '..', 'logs', 'service.log')
    mkdirSync(dirname(logFilePath), { recursive: true })
    fileStream = createWriteStream(logFilePath, { flags: 'a' })
    streams.push({ stream: fileStream })
  }

  const logger = pino(base, multistream(streams, { dedupe: false }))

  return {
    logger,
    logFilePath,
    close: async () => {
      if (!fileStream) return
      await new Promise<void>((resolve) => fileStream?.end(() => resolve()))
    }
  }
}
