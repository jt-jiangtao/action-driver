import { createLogger, INTERACTION_REDACT_PATHS, type ActionDriverLogger } from '@actiondriver/observability'
import { dirname, join } from 'node:path'

export const REDACTED_LOG_PATHS = INTERACTION_REDACT_PATHS

export type ServiceLoggerOptions = {
  level?: string
  pretty?: boolean
  databasePath?: string
  name?: string
}

export type ServiceLogger = ActionDriverLogger

/**
 * Service logger: readable output for developer runs plus a JSON log file next to the runtime data
 * so interactions stay inspectable when the app is launched without a terminal.
 */
export function createServiceLogger(options: ServiceLoggerOptions = {}): ServiceLogger {
  return createLogger({
    name: options.name ?? 'actiondriver-service',
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.pretty === undefined ? {} : { pretty: options.pretty }),
    ...(options.databasePath === undefined
      ? {}
      : { filePath: join(dirname(options.databasePath), '..', 'logs', 'service.log') })
  })
}
