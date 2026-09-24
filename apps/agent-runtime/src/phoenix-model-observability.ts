import { SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api'
import type { ModelTraceFinish, ModelTracePort, ModelTraceStart } from './model-trace-port'

/** Complete model content lives on OpenInference spans routed to the local Phoenix collector. */
export class PhoenixModelObservability implements ModelTracePort {
  private readonly active = new Map<string, Span>()

  constructor(private readonly tracer: Tracer) {}

  async start(run: ModelTraceStart): Promise<void> {
    const span = this.tracer.startSpan(`chat ${run.model.modelId}`, {
      startTime: new Date(run.startedAt),
      attributes: {
        'openinference.span.kind': 'LLM',
        'llm.model_name': run.model.modelId,
        'session.id': run.sessionId,
        'task.id': run.taskId,
        'request.id': run.requestId,
        'correlation.id': run.correlationId
      }
    })
    span.setAttribute('input.value', JSON.stringify(withoutCredentials(run.input)))
    span.setAttribute('input.mime_type', 'application/json')
    this.active.set(run.id, span)
  }

  async finish(id: string, result: ModelTraceFinish): Promise<void> {
    const span = this.active.get(id)
    if (!span) return
    this.active.delete(id)
    if (result.output !== undefined) {
      span.setAttribute('output.value', JSON.stringify(withoutCredentials(result.output)))
      span.setAttribute('output.mime_type', 'application/json')
    }
    if (result.usage !== undefined) {
      span.setAttribute('llm.token_count', JSON.stringify(result.usage))
    }
    span.setStatus(result.error === undefined
      ? { code: SpanStatusCode.OK }
      : { code: SpanStatusCode.ERROR, message: redactCredentialText(result.error) })
    span.end(new Date(result.completedAt))
  }
}

function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials)
  if (typeof value === 'string') return redactCredentialText(value)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) =>
    /^(api[-_]?key|authorization|cookie|password|token)$/i.test(key)
      ? []
      : [[key, withoutCredentials(nested)]]
  ))
}

function redactCredentialText(value: string): string {
  return value.replace(/Bearer\s+[^\s]+|sk-[A-Za-z0-9_-]+/gi, '[redacted]')
}
