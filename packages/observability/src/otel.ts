import { context, metrics, trace, SpanStatusCode, type Meter, type Tracer } from '@opentelemetry/api'
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter
} from '@opentelemetry/sdk-logs'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:4318'
const CLOSE_TIMEOUT_MS = 3_000
const LOG_ATTRIBUTE_KEYS = new Set([
  'transport',
  'direction',
  'operation',
  'outcome',
  'durationMs',
  'taskId',
  'requestId',
  'sessionId',
  'correlationId',
  'status',
  'errorCode',
  'trace_id',
  'span_id',
  'model',
  'tool'
])

export type StructuredLogger = {
  debug(attributes: Record<string, unknown>, message?: string): void
  info(attributes: Record<string, unknown>, message?: string): void
  warn(attributes: Record<string, unknown>, message?: string): void
  error(attributes: Record<string, unknown>, message?: string): void
  child(attributes: Record<string, unknown>): StructuredLogger
}

export type ProcessObservability = {
  logger: StructuredLogger
  tracer: Tracer
  meter: Meter
  status(): { exportFailures: number }
  close(): Promise<void>
}

export type ProcessObservabilityOptions = {
  serviceName: string
  endpoint?: string
  logExporter?: LogRecordExporter
  closeTimeoutMs?: number
}

export function currentTraceparent(): string | undefined {
  const span = trace.getSpanContext(context.active())
  if (!span || !trace.isSpanContextValid(span)) return undefined
  return `00-${span.traceId}-${span.spanId}-${span.traceFlags.toString(16).padStart(2, '0')}`
}

export function withRemoteTraceparent<T>(value: string, run: () => Promise<T>): Promise<T> {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value)
  if (!match) return run()
  const spanContext = {
    traceId: match[1]!,
    spanId: match[2]!,
    traceFlags: Number.parseInt(match[3]!, 16),
    isRemote: true
  }
  if (!trace.isSpanContextValid(spanContext)) return run()
  return context.with(trace.setSpanContext(context.active(), spanContext), () =>
    trace.getTracer('actiondriver-runtime').startActiveSpan('actiondriver.runtime.rpc', async (span) => {
      try {
        const result = await run()
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    })
  )
}

export function createProcessObservability(
  options: ProcessObservabilityOptions
): ProcessObservability {
  const endpoint = (options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_ENDPOINT)
    .replace(/\/$/, '')
  const resource = resourceFromAttributes({ 'service.name': options.serviceName })
  const closeTimeoutMs = options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS
  const failureCounter = { count: 0 }
  const logExporter = monitorLogExporter(
    options.logExporter ?? new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
    failureCounter
  )
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 15_000,
        exportTimeoutMillis: 2_000
      })
    ]
  })
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
        { exportTimeoutMillis: 2_000 }
      )
    ]
  })
  const loggerProvider = new LoggerProvider({
    resource,
    meterProvider,
    processors: [
      new BatchLogRecordProcessor({
        exporter: logExporter,
        exportTimeoutMillis: 2_000,
        scheduledDelayMillis: 1_000,
        selfObsMeterProvider: meterProvider
      })
    ]
  })
  tracerProvider.register()
  metrics.setGlobalMeterProvider(meterProvider)
  logs.setGlobalLoggerProvider(loggerProvider)

  const otelLogger = loggerProvider.getLogger(options.serviceName)
  const emit = (severityNumber: SeverityNumber, severityText: string, base: Record<string, unknown>) =>
    (attributes: Record<string, unknown>): void => {
      const safeAttributes = pickLogAttributes({ ...base, ...attributes })
      const activeSpan = trace.getSpan(context.active())?.spanContext()
      if (activeSpan) {
        safeAttributes.trace_id = activeSpan.traceId
        safeAttributes.span_id = activeSpan.spanId
      }
      // Free-form messages may contain model content. The operation/outcome attributes carry meaning.
      otelLogger.emit({
        severityNumber,
        severityText,
        body: 'actiondriver.event',
        attributes: safeAttributes
      })
    }

  const makeLogger = (base: Record<string, unknown>): StructuredLogger => ({
    debug: emit(SeverityNumber.DEBUG, 'DEBUG', base),
    info: emit(SeverityNumber.INFO, 'INFO', base),
    warn: emit(SeverityNumber.WARN, 'WARN', base),
    error: emit(SeverityNumber.ERROR, 'ERROR', base),
    child: (attributes) => makeLogger({ ...base, ...attributes })
  })
  let closed = false
  return {
    logger: makeLogger({}),
    tracer: tracerProvider.getTracer(options.serviceName),
    meter: meterProvider.getMeter(options.serviceName),
    status: () => ({ exportFailures: failureCounter.count }),
    close: async () => {
      if (closed) return
      closed = true
      await bounded(
        Promise.allSettled([
          loggerProvider.forceFlush({ timeoutMillis: 2_000 }),
          tracerProvider.forceFlush({ timeoutMillis: 2_000 }),
          meterProvider.forceFlush({ timeoutMillis: 2_000 })
        ]).then(() => undefined),
        failureCounter,
        closeTimeoutMs
      )
      await bounded(
        Promise.allSettled([
          loggerProvider.shutdown(),
          tracerProvider.shutdown(),
          meterProvider.shutdown()
        ]).then(() => undefined),
        failureCounter,
        closeTimeoutMs
      )
    }
  }
}

function pickLogAttributes(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!LOG_ATTRIBUTE_KEYS.has(key)) continue
    if (typeof value === 'string') result[key] = value.slice(0, 256)
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
    else if (typeof value === 'boolean') result[key] = value
  }
  return result
}

function monitorLogExporter(
  exporter: LogRecordExporter,
  failures: { count: number }
): LogRecordExporter {
  return {
    export(records, callback) {
      try {
        exporter.export(records, (result) => {
          if (result.code !== 0) failures.count++
          callback(result)
        })
      } catch (error) {
        failures.count++
        throw error
      }
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown()
  }
}

async function bounded(
  promise: Promise<void>,
  failures: { count: number },
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OBSERVABILITY_CLOSE_TIMEOUT')), timeoutMs)
      })
    ])
  } catch {
    failures.count++
  } finally {
    if (timer) clearTimeout(timer)
  }
}
