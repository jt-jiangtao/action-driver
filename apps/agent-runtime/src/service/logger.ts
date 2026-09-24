import { createProcessObservability, INTERACTION_REDACT_PATHS, type ProcessObservability } from '@actiondriver/observability'

export const REDACTED_LOG_PATHS = INTERACTION_REDACT_PATHS

export type ServiceLoggerOptions = {
  level?: string
  pretty?: boolean
  databasePath?: string
  name?: string
}

export type ServiceLogger = ProcessObservability

/**
 * Service process telemetry is exported over OTLP. No operational log is written beside runtime data.
 */
export function createServiceLogger(options: ServiceLoggerOptions = {}): ServiceLogger {
  return createProcessObservability({ serviceName: options.name ?? 'actiondriver-service' })
}
