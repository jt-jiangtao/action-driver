import type { ModelCompletionServicePort, ModelFailureCode } from '@actiondriver/model-connections'
import type { InteractionLogRecorder } from '@actiondriver/observability'
import { randomUUID } from 'node:crypto'
import type { ModelTraceFinish, ModelTracePort } from '../model-trace-port'
import { isModelCredentialKey } from '../model-credential-key'
import type { ModelGateway, ModelRequest } from '../ports'

export class ModelExecutionError extends Error {
  constructor(
    readonly code: ModelFailureCode,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ModelExecutionError'
  }
}

export class ConnectionModelGateway implements ModelGateway {
  constructor(
    private readonly options: {
      service: ModelCompletionServicePort
      interactions: InteractionLogRecorder
      correlationId(): string
      now(): string
      traces?: ModelTracePort
    }
  ) {}

  async *stream(request: ModelRequest, signal?: AbortSignal) {
    const correlationId = this.options.correlationId()
    const startedAt = this.options.now()
    const requestBody = sanitizeCredentialFields(toOpenAiRequestBody(request, true))
    const traceId = randomUUID()
    await this.startTrace(traceId, request, correlationId, startedAt, requestBody)
    const finishInteraction = await this.options.interactions.start({
      correlationId,
      transport: 'http',
      direction: 'service->model',
      operation: 'POST /chat/completions',
      requestId: request.requestId,
      taskId: request.taskId,
      request: { kind: 'json', value: requestBody }
    })

    try {
      let ended = false
      for await (const event of this.options.service.stream(
        {
          model: request.model,
          requestId: request.requestId,
          taskId: request.taskId,
          messages: request.messages,
          ...(request.tools === undefined ? {} : { tools: request.tools }),
          parameters: request.parameters
        },
        signal
      )) {
        if (event.kind === 'content') {
          yield event
          continue
        }

        ended = true
        const completedAt = this.options.now()
        const safeResponse = sanitizeCredentialFields(event.responseBody)
        await finishInteraction({
          outcome: 'ok',
          status: event.status,
          response: { kind: 'json', value: safeResponse }
        })
        await this.finishTrace(traceId, { completedAt, output: safeResponse, usage: event.usage })
        yield {
          kind: 'end' as const,
          result: event.result ?? { kind: 'final-text', content: event.content },
          content: event.content,
          finishReason: event.finishReason,
          usage: event.usage
        }
      }

      if (!ended) {
        throw new ModelExecutionError(
          'invalid-response',
          'Model stream ended without a terminal event',
          false
        )
      }
    } catch (caught) {
      const completedAt = this.options.now()
      const error =
        caught instanceof ModelExecutionError
          ? {
              code: caught.code,
              message: caught.message,
              retryable: caught.retryable
            }
          : toStructuredError(caught)
      await finishInteraction({
        outcome: 'error',
        error: { code: error.code, message: error.message }
      })
      await this.finishTrace(traceId, { completedAt, error: error.message })
      throw new ModelExecutionError(error.code, error.message, error.retryable)
    }
  }

  async complete(request: ModelRequest, signal?: AbortSignal) {
    const correlationId = this.options.correlationId()
    const startedAt = this.options.now()
    const requestBody = sanitizeCredentialFields(toOpenAiRequestBody(request, false))
    const traceId = randomUUID()
    await this.startTrace(traceId, request, correlationId, startedAt, requestBody)
    const finishInteraction = await this.options.interactions.start({
      correlationId,
      transport: 'http',
      direction: 'service->model',
      operation: 'POST /chat/completions',
      requestId: request.requestId,
      taskId: request.taskId,
      request: { kind: 'json', value: requestBody }
    })

    try {
      const outcome = await this.options.service.complete(
        {
          model: request.model,
          requestId: request.requestId,
          taskId: request.taskId,
          messages: request.messages,
          ...(request.tools === undefined ? {} : { tools: request.tools }),
          parameters: request.parameters
        },
        signal
      )
      const completedAt = this.options.now()
      if (outcome.ok) {
        const safeResponse = sanitizeCredentialFields(outcome.value.responseBody)
        await finishInteraction({
          outcome: 'ok',
          status: outcome.value.status,
          response: { kind: 'json', value: safeResponse }
        })
        await this.finishTrace(traceId, { completedAt, output: safeResponse })
        return { kind: 'finish' as const, content: outcome.value.content }
      }

      const safeResponse = sanitizeCredentialFields(outcome.responseBody)
      const error = {
        code: outcome.failure.code,
        message: outcome.failure.message,
        retryable: outcome.failure.retryable
      }
      await finishInteraction({
        outcome: 'error',
        ...(outcome.status === null ? {} : { status: outcome.status }),
        ...(safeResponse === null
          ? {}
          : { response: { kind: 'json' as const, value: safeResponse } }),
        error: { code: error.code, message: error.message }
      })
      await this.finishTrace(traceId, { completedAt, output: safeResponse, error: error.message })
      throw new ModelExecutionError(error.code, error.message, error.retryable)
    } catch (caught) {
      if (caught instanceof ModelExecutionError) throw caught
      const completedAt = this.options.now()
      const error = toStructuredError(caught)
      await finishInteraction({
        outcome: 'error',
        error: { code: error.code, message: error.message }
      })
      await this.finishTrace(traceId, { completedAt, error: error.message })
      throw new ModelExecutionError(error.code, error.message, error.retryable)
    }
  }

  private async startTrace(
    id: string,
    request: ModelRequest,
    correlationId: string,
    startedAt: string,
    input: unknown
  ): Promise<void> {
    try {
      const userMessage = request.messages.find((message) => message.role === 'user')
      const sessionName = userMessage && 'content' in userMessage ? userMessage.content : undefined
      await this.options.traces?.start({
        id,
        sessionId: request.sessionId ?? request.taskId,
        ...(typeof sessionName === 'string' ? { sessionName: sessionName.slice(0, 120) } : {}),
        taskId: request.taskId,
        requestId: request.requestId,
        correlationId,
        model: request.model,
        startedAt,
        input
      })
    } catch {
      /* Observability cannot change the model execution result. */
    }
  }

  private async finishTrace(id: string, result: ModelTraceFinish): Promise<void> {
    try {
      await this.options.traces?.finish(id, result)
    } catch {
      /* Telemetry must never change the model execution result. */
    }
  }
}

function toOpenAiRequestBody(request: ModelRequest, stream: boolean): unknown {
  return {
    model: request.model.modelId,
    messages: request.messages,
    ...(request.tools === undefined ? {} : { tools: request.tools }),
    ...(request.parameters.temperature === undefined
      ? {}
      : { temperature: request.parameters.temperature }),
    ...(request.parameters.maxTokens === undefined
      ? {}
      : { max_tokens: request.parameters.maxTokens }),
    stream
  }
}

function toStructuredError(caught: unknown): {
  code: ModelFailureCode
  message: string
  retryable: boolean
} {
  if (caught && typeof caught === 'object') {
    const value = caught as { code?: unknown; message?: unknown; retryable?: unknown }
    return {
      code: isModelFailureCode(value.code) ? value.code : 'unknown',
      message: typeof value.message === 'string' ? value.message : String(caught),
      retryable: value.retryable === true
    }
  }
  return { code: 'unknown', message: String(caught), retryable: false }
}

function isModelFailureCode(value: unknown): value is ModelFailureCode {
  return [
    'unauthorized',
    'not-found',
    'model-not-found',
    'rate-limited',
    'provider-error',
    'network',
    'timeout',
    'cancelled',
    'invalid-request',
    'invalid-response',
    'secret-unavailable',
    'storage-error',
    'unknown'
  ].includes(String(value))
}

function sanitizeCredentialFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeCredentialFields)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      isModelCredentialKey(key) ? [] : [[key, sanitizeCredentialFields(nested)]]
    )
  )
}
