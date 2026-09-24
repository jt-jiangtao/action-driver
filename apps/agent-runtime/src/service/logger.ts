import { createProcessObservability, type ProcessObservability } from '@actiondriver/observability'

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
