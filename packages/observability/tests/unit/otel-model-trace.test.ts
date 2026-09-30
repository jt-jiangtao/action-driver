import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-node'
import { describe, expect, it } from 'vitest'
import { ConnectionModelGateway } from '../../../../packages/agent-runtime/src/model-gateway'
import { PhoenixModelObservability } from '../../../../apps/local-runtime/src/phoenix-model-observability'
import type { ModelRequest } from '../../../../packages/agent-runtime/src/ports'
import { MemoryInteractionLogStore, createInteractionLogRecorder } from '../../src/interaction-store'

describe('model span parent chain', () => {
  it('records a model call under the active Runtime call with matching trace and identifiers', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
    const contextManager = new AsyncLocalStorageContextManager().enable()
    context.setGlobalContextManager(contextManager)
    const tracer = provider.getTracer('action-driver-runtime-test')
    const request: ModelRequest = {
      sessionId: 'session-parent',
      taskId: 'task-parent',
      requestId: 'request-parent',
      model: { connectionId: 'connection-parent', modelId: 'model-parent' },
      messages: [{ role: 'user', content: 'INPUT_PARENT_MARKER' }],
      skills: [],
      parameters: {}
    }
    const service = {
      async complete() {
        return {
          ok: true as const,
          value: {
            content: 'OUTPUT_PARENT_MARKER',
            providerProtocol: 'openai-compatible' as const,
            requestBody: {},
            responseBody: { content: 'OUTPUT_PARENT_MARKER' },
            status: 200
          }
        }
      },
      async *stream() {
        yield* [] as never[]
        throw new Error('unexpected stream')
      }
    }
    const gateway = new ConnectionModelGateway({
      service,
      interactions: createInteractionLogRecorder({
        store: new MemoryInteractionLogStore(),
        ids: { eventId: () => 'event-parent', correlationId: () => 'unused' }
      }),
      traces: new PhoenixModelObservability(tracer),
      correlationId: () => 'correlation-parent',
      now: () => new Date().toISOString()
    })
    try {
      await tracer.startActiveSpan('action-driver.call', async (parent) => {
        try {
          await expect(gateway.complete(request)).resolves.toMatchObject({
            content: 'OUTPUT_PARENT_MARKER'
          })
        } finally {
          parent.end()
        }
      })
      const spans = exporter.getFinishedSpans()
      const parent = spans.find((span) => span.name === 'action-driver.call')
      const model = spans.find((span) => span.name === 'chat model-parent')
      expect(parent).toBeDefined()
      expect(model).toBeDefined()
      expect(model?.spanContext().traceId).toBe(parent?.spanContext().traceId)
      expect(model?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId)
      expect(model?.attributes).toMatchObject({
        'session.id': 'session-parent',
        'task.id': 'task-parent',
        'request.id': 'request-parent',
        'correlation.id': 'correlation-parent'
      })
      expect(model?.attributes['input.value']).toContain('INPUT_PARENT_MARKER')
      expect(model?.attributes['output.value']).toContain('OUTPUT_PARENT_MARKER')
    } finally {
      await provider.shutdown()
      context.disable()
    }
  })
})
