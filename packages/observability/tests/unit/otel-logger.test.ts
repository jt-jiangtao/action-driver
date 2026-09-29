import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs'
import * as observability from '../../src/index'
import { startLocalOtelCollector } from '../../../../tests/otel-collector'

let collector: Awaited<ReturnType<typeof startLocalOtelCollector>>
beforeAll(async () => { collector = await startLocalOtelCollector() })
afterAll(async () => { await collector.close() })

describe('OpenTelemetry process observability', () => {
  it('exports only allowed structured fields through the Logs SDK', async () => {
    const records: ReadableLogRecord[] = []
    const exporter: LogRecordExporter = {
      export(logs, callback) {
        records.push(...logs)
        callback({ code: 0 })
      },
      forceFlush: async () => {},
      shutdown: async () => {}
    }
    const factory = (observability as Record<string, unknown>).createProcessObservability as
      | ((input: {
          serviceName: string
          endpoint: string
          logExporter: LogRecordExporter
        }) => {
          logger: { info(attributes: Record<string, unknown>, message: string): void }
          tracer: { startActiveSpan<T>(name: string, fn: (span: { spanContext(): { traceId: string }; end(): void }) => T): T }
          status(): { exportFailures: number }
          close(): Promise<void>
        })
      | undefined
    expect(factory).toBeTypeOf('function')
    const process = factory!({
      serviceName: 'actiondriver-test',
      endpoint: collector.endpoint,
      logExporter: exporter
    })
    let activeTraceId = ''
    process.tracer.startActiveSpan('task.run', (span) => {
      activeTraceId = span.spanContext().traceId
      process.logger.info(
        { operation: 'task.run', taskId: 'task-1', request: 'PROMPT_NEVER_IN_LOKI' },
        'MESSAGE_NEVER_IN_LOKI'
      )
      span.end()
    })
    await process.close()

    expect(records).toHaveLength(1)
    expect(records[0]?.attributes).toMatchObject({
      operation: 'task.run',
      taskId: 'task-1',
      trace_id: activeTraceId
    })
    expect(records[0]?.resource.attributes['service.name']).toBe('actiondriver-test')
    expect(JSON.stringify(records)).not.toMatch(/PROMPT_NEVER_IN_LOKI|MESSAGE_NEVER_IN_LOKI/)
  })

  it('reports a failed export without throwing into the caller', async () => {
    const factory = observability.createProcessObservability
    const process = factory({
      serviceName: 'actiondriver-failure-test',
      endpoint: collector.endpoint,
      logExporter: {
        export(_records, callback) {
          callback({ code: 1, error: new Error('collector unavailable') })
        },
        forceFlush: async () => {},
        shutdown: async () => {}
      }
    })
    expect(() => process.logger.error({ operation: 'task.run', errorCode: 'FAILED' }, 'failed')).not.toThrow()
    await process.close()
    expect(process.status().exportFailures).toBeGreaterThan(0)
  })

  it('bounds shutdown when an exporter never completes', async () => {
    const process = observability.createProcessObservability({
      serviceName: 'actiondriver-timeout-test',
      endpoint: collector.endpoint,
      closeTimeoutMs: 25,
      logExporter: {
        export() {},
        forceFlush: () => new Promise<void>(() => {}),
        shutdown: () => new Promise<void>(() => {})
      }
    })
    process.logger.info({ operation: 'task.run' }, 'task started')
    const started = Date.now()
    await process.close()
    expect(Date.now() - started).toBeLessThan(500)
    expect(process.status().exportFailures).toBeGreaterThan(0)
  }, 10_000)

  it('keeps business logging non-blocking when the batch queue is saturated', async () => {
    const process = observability.createProcessObservability({
      serviceName: 'actiondriver-pressure-test',
      endpoint: collector.endpoint,
      closeTimeoutMs: 25,
      logExporter: {
        export() {},
        forceFlush: () => new Promise<void>(() => {}),
        shutdown: () => new Promise<void>(() => {})
      }
    })
    expect(() => {
      for (let index = 0; index < 10_000; index++) {
        process.logger.info({ operation: 'task.run', requestId: `request-${index}` })
      }
    }).not.toThrow()
    await process.close()
    expect(process.status().exportFailures).toBeGreaterThan(0)
  }, 10_000)
})
