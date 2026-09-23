import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  OpenAIError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError
} from 'openai'
import type { HttpTransport } from './http-transport'
import { HttpTransportError } from './http-transport'
import type {
  ModelInputMessage,
  ModelCompletionEvent,
  ModelCompletionOutcome,
  ModelFailureCode,
  ModelProtocol,
  ModelUsage
} from './types'
import type { ToolDefinition } from '@actiondriver/runtime-contracts'

export type ProviderFailure = {
  code: ModelFailureCode
  message: string
}

export type ProviderProbeResult =
  | { state: 'success' }
  | { state: 'unsupported'; failure: ProviderFailure }
  | { state: 'failed'; failure: ProviderFailure }

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; failure: ProviderFailure }

export type OpenAiStreamChunk = {
  choices: Array<{
    delta: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
    index: number
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null
}

export type OpenAiClientOptions = {
  apiKey: string
  baseURL: string
  maxRetries: 0
  timeout: number
  logLevel: 'off'
}

export type OpenAiClientLike = {
  chat: {
    completions: {
      create(
        body: Record<string, unknown>,
        options: { signal?: AbortSignal }
      ): {
        withResponse(): Promise<{
          data: AsyncIterable<OpenAiStreamChunk>
          response: { status: number }
          request_id: string | null
        }>
      }
    }
  }
}

export type OpenAiClientFactory = (options: OpenAiClientOptions) => OpenAiClientLike

export class ModelStreamError extends Error {
  constructor(
    readonly code: ModelFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'ModelStreamError'
  }
}

export interface ModelProviderAdapter {
  discover(input: ModelEndpoint): Promise<ProviderResult<string[]>>
  verifyConnection(input: ModelEndpoint): Promise<ProviderResult<null>>
  probeModel(input: ModelEndpoint & { modelId: string }): Promise<ProviderProbeResult>
  complete(input: ProviderCompletionInput, signal?: AbortSignal): Promise<ModelCompletionOutcome>
  stream(input: ProviderCompletionInput, signal?: AbortSignal): AsyncIterable<ModelCompletionEvent>
}

export type ModelEndpoint = {
  baseUrl: string
  apiKey: string
}

export type ProviderCompletionInput = ModelEndpoint & {
  modelId: string
  messages: ModelInputMessage[]
  tools?: ToolDefinition[]
  parameters: { temperature?: number; maxTokens?: number }
}

export const CONNECTION_TEST_TIMEOUT_MS = 10_000
export const MODEL_REQUEST_TIMEOUT_MS = 15_000

const PROBE_MAX_TOKENS = 8
const ANTHROPIC_VERSION = '2023-06-01'
/** Sentinel model id used only to prove that endpoint and credentials work. */
const CONNECTION_PROBE_MODEL = 'connection-probe'

export function createModelProviderAdapter(
  protocol: ModelProtocol,
  transport: HttpTransport,
  openAiClientFactory: OpenAiClientFactory = defaultOpenAiClientFactory
): ModelProviderAdapter {
  return protocol === 'anthropic'
    ? createAnthropicAdapter(transport)
    : createOpenAiCompatibleAdapter(transport, openAiClientFactory)
}

export function createOpenAiCompatibleAdapter(
  transport: HttpTransport,
  openAiClientFactory: OpenAiClientFactory = defaultOpenAiClientFactory
): ModelProviderAdapter {
  const discover: ModelProviderAdapter['discover'] = async ({ baseUrl, apiKey }) => {
    const response = await send(transport, {
      url: `${normalizeBaseUrl(baseUrl)}/models`,
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      timeoutMs: CONNECTION_TEST_TIMEOUT_MS
    })
    if (!response.ok) return response

    const models = readModelIds(response.value.body)
    if (!models) {
      return {
        ok: false,
        failure: failure(
          'invalid-response',
          'Model list response is missing a model identifier list'
        )
      }
    }
    return { ok: true, value: models }
  }

  return {
    discover,
    async *stream({ baseUrl, apiKey, modelId, messages, tools = [], parameters }, signal) {
      const requestBody = streamRequestBody(modelId, messages, tools, parameters)
      if (signal?.aborted) {
        throw new ModelStreamError('cancelled', 'Model request was cancelled')
      }
      const headers = { authorization: `Bearer ${apiKey}` }
      let stream: AsyncIterable<OpenAiStreamChunk>
      let status: number
      let providerRequestId: string | null
      try {
        const client = openAiClientFactory({
          apiKey,
          baseURL: normalizeBaseUrl(baseUrl),
          maxRetries: 0,
          timeout: MODEL_REQUEST_TIMEOUT_MS,
          logLevel: 'off'
        })
        const result = await client.chat.completions
          .create(requestBody as Record<string, unknown>, { ...(signal ? { signal } : {}) })
          .withResponse()
        stream = result.data
        status = result.response.status
        providerRequestId = result.request_id
      } catch (error) {
        throw toSafeStreamError(error, headers)
      }

      let content = ''
      let finishReason: string | null = null
      let usage: ModelUsage | null = null
      const pendingToolCalls = new Map<
        number,
        { providerCallId: string; modelName: string; argumentsText: string }
      >()
      try {
        for await (const chunk of stream) {
          const choice = chunk.choices[0]
          const delta = choice?.delta.content
          if (typeof delta === 'string' && delta.length > 0) {
            content += delta
            yield { kind: 'content', delta }
          }
          for (const toolCall of choice?.delta.tool_calls ?? []) {
            const current = pendingToolCalls.get(toolCall.index) ?? {
              providerCallId: '',
              modelName: '',
              argumentsText: ''
            }
            if (toolCall.id) current.providerCallId = toolCall.id
            if (toolCall.function?.name) current.modelName = toolCall.function.name
            if (toolCall.function?.arguments) {
              current.argumentsText += toolCall.function.arguments
            }
            pendingToolCalls.set(toolCall.index, current)
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens
            }
          }
        }
      } catch (error) {
        throw toSafeStreamError(error, headers)
      }
      const result =
        finishReason === 'tool_calls'
          ? {
              kind: 'tool-calls' as const,
              calls: parsePendingToolCalls(pendingToolCalls)
            }
          : { kind: 'final-text' as const, content }
      if (result.kind === 'final-text' && !content.trim()) {
        throw new ModelStreamError('invalid-response', 'Model stream ended without assistant text')
      }
      if (!finishReason) {
        throw new ModelStreamError('invalid-response', 'Model stream ended without a finish reason')
      }

      const responseBody = {
        content,
        finishReason,
        usage,
        providerRequestId,
        ...(result.kind === 'tool-calls' ? { toolCalls: result.calls } : {})
      }
      yield { kind: 'end', result, content, finishReason, usage, requestBody, responseBody, status }
    },
    async complete({ baseUrl, apiKey, modelId, messages, parameters }, signal) {
      const requestBody = {
        model: modelId,
        messages: toOpenAiMessages(messages),
        ...(parameters.temperature === undefined ? {} : { temperature: parameters.temperature }),
        ...(parameters.maxTokens === undefined ? {} : { max_tokens: parameters.maxTokens }),
        stream: false
      }
      if (signal?.aborted) {
        return completionFailure(
          failure('cancelled', 'Model request was cancelled'),
          requestBody,
          null,
          null
        )
      }
      const response = await sendCompletion(
        transport,
        {
          url: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          body: requestBody,
          timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
          ...(signal ? { signal } : {})
        },
        requestBody
      )
      if (!response.ok) return response

      const content = readAssistantContent(response.value.body)
      if (!content) {
        return completionFailure(
          failure('invalid-response', 'Model response is missing assistant text'),
          requestBody,
          response.value.body,
          response.value.status
        )
      }
      return {
        ok: true,
        value: {
          content,
          providerProtocol: 'openai-compatible',
          requestBody,
          responseBody: response.value.body,
          status: response.value.status
        }
      }
    },
    async verifyConnection(input) {
      const result = await discover(input)
      return result.ok ? { ok: true, value: null } : result
    },
    async probeModel({ baseUrl, apiKey, modelId }) {
      const response = await send(transport, {
        url: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: PROBE_MAX_TOKENS
        },
        timeoutMs: MODEL_REQUEST_TIMEOUT_MS
      })
      return probeResult(response)
    }
  }
}

export function createAnthropicAdapter(transport: HttpTransport): ModelProviderAdapter {
  // The Anthropic compatible endpoint exposes no model list, so discovery stays empty and models
  // are added manually. Missing discovery must not be reported as a connection failure.
  const discover = async (): Promise<ProviderResult<string[]>> => ({ ok: true, value: [] })
  const probeModel: ModelProviderAdapter['probeModel'] = async ({ baseUrl, apiKey, modelId }) => {
    const response = await send(transport, {
      url: `${normalizeBaseUrl(baseUrl)}/v1/messages`,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: {
        model: modelId,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: 'user', content: 'ping' }]
      },
      timeoutMs: MODEL_REQUEST_TIMEOUT_MS
    })
    return probeResult(response)
  }

  return {
    discover,
    stream() {
      const iterator: AsyncIterator<ModelCompletionEvent> & AsyncIterable<ModelCompletionEvent> = {
        [Symbol.asyncIterator]() {
          return iterator
        },
        async next(): Promise<IteratorResult<ModelCompletionEvent>> {
          throw new ModelStreamError('invalid-request', 'Agent 调用暂未接入')
        }
      }
      return iterator
    },
    async complete(input) {
      return completionFailure(
        failure('invalid-request', 'Agent 调用暂未接入'),
        {
          model: input.modelId,
          messages: input.messages,
          ...input.parameters,
          stream: false
        },
        null,
        null
      )
    },
    async verifyConnection({ baseUrl, apiKey }) {
      const result = await probeModel({
        baseUrl,
        apiKey,
        modelId: CONNECTION_PROBE_MODEL
      })
      if (result.state === 'success') return { ok: true, value: null }
      // "Model not exist" proves the route and credentials are valid; only the sentinel is unknown.
      if (result.failure.code === 'model-not-found') return { ok: true, value: null }
      return { ok: false, failure: result.failure }
    },
    probeModel
  }
}

function streamRequestBody(
  modelId: string,
  messages: ProviderCompletionInput['messages'],
  tools: ToolDefinition[],
  parameters: ProviderCompletionInput['parameters']
): Record<string, unknown> {
  return {
    model: modelId,
    messages: toOpenAiMessages(messages),
    ...(parameters.temperature === undefined ? {} : { temperature: parameters.temperature }),
    ...(parameters.maxTokens === undefined ? {} : { max_tokens: parameters.maxTokens }),
    stream: true,
    stream_options: { include_usage: true },
    ...(tools.length === 0
      ? {}
      : {
          tools: tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.modelName,
              description: tool.description,
              parameters: tool.inputSchema
            }
          })),
          tool_choice: 'auto'
        })
  }
}

function toOpenAiMessages(messages: ModelInputMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if ('toolCalls' in message) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.providerCallId,
          type: 'function',
          function: { name: call.modelName, arguments: JSON.stringify(call.arguments) }
        }))
      }
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content
      }
    }
    return message
  })
}

function parsePendingToolCalls(
  pending: Map<number, { providerCallId: string; modelName: string; argumentsText: string }>
) {
  if (pending.size === 0) {
    throw new ModelStreamError('invalid-response', 'Tool-call finish reason contained no calls')
  }
  return [...pending.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => {
      if (!call.providerCallId || !call.modelName) {
        throw new ModelStreamError('invalid-response', 'Tool call is missing id or function name')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(call.argumentsText)
      } catch {
        throw new ModelStreamError('invalid-response', 'Tool call arguments are not valid JSON')
      }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new ModelStreamError('invalid-response', 'Tool call arguments must be an object')
      }
      return {
        providerCallId: call.providerCallId,
        modelName: call.modelName,
        arguments: parsed as Record<string, unknown>
      }
    })
}

function toSafeStreamError(error: unknown, headers: Record<string, string>): ModelStreamError {
  const providerFailure = classifySdkError(error)
  const redacted = redactProviderFailure(providerFailure, headers)
  return new ModelStreamError(redacted.code, redacted.message)
}

function classifySdkError(error: unknown): ProviderFailure {
  if (error instanceof ModelStreamError) return failure(error.code, error.message)
  if (error instanceof APIUserAbortError) return failure('cancelled', 'Model request was cancelled')
  if (error instanceof APIConnectionTimeoutError) return failure('timeout', error.message)
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return failure('unauthorized', error.message)
  }
  if (error instanceof RateLimitError) return failure('rate-limited', error.message)
  if (error instanceof NotFoundError) {
    return failure(
      isModelMissing(error.error, error.message) ? 'model-not-found' : 'not-found',
      error.message
    )
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return failure('invalid-request', error.message)
  }
  if (error instanceof InternalServerError) return failure('provider-error', error.message)
  if (error instanceof APIConnectionError) return failure('network', error.message)
  if (error instanceof APIError) {
    return (
      classifyResponse(error.status ?? 0, error.error, error.message) ??
      failure('unknown', error.message)
    )
  }
  if (error instanceof OpenAIError) return failure('invalid-response', error.message)
  return failure('unknown', error instanceof Error ? error.message : String(error))
}

const defaultOpenAiClientFactory: OpenAiClientFactory = (options) =>
  new OpenAI(options) as unknown as OpenAiClientLike

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

type SendResult =
  | { ok: true; value: { status: number; body: unknown; text: string } }
  | { ok: false; failure: ProviderFailure }

async function send(
  transport: HttpTransport,
  request: Parameters<HttpTransport['request']>[0]
): Promise<SendResult> {
  try {
    const response = await transport.request(request)
    const classification = classifyResponse(response.status, response.body, response.text)
    if (classification) {
      return { ok: false, failure: redactProviderFailure(classification, request.headers) }
    }
    return { ok: true, value: response }
  } catch (error) {
    if (error instanceof HttpTransportError) {
      return {
        ok: false,
        failure: redactProviderFailure(failure(error.code, error.message), request.headers)
      }
    }
    return {
      ok: false,
      failure: redactProviderFailure(
        failure('unknown', error instanceof Error ? error.message : String(error)),
        request.headers
      )
    }
  }
}

async function sendCompletion(
  transport: HttpTransport,
  request: Parameters<HttpTransport['request']>[0],
  requestBody: unknown
): Promise<
  | { ok: true; value: { status: number; body: unknown; text: string } }
  | Extract<ModelCompletionOutcome, { ok: false }>
> {
  try {
    const response = await transport.request(request)
    const classification = classifyResponse(response.status, response.body, response.text)
    if (classification) {
      return completionFailure(
        redactProviderFailure(classification, request.headers),
        requestBody,
        redactProviderPayload(response.body, request.headers),
        response.status
      )
    }
    return {
      ok: true,
      value: { ...response, body: redactProviderPayload(response.body, request.headers) }
    }
  } catch (error) {
    const providerFailure =
      error instanceof HttpTransportError
        ? failure(error.code, error.message)
        : failure('unknown', error instanceof Error ? error.message : String(error))
    return completionFailure(
      redactProviderFailure(providerFailure, request.headers),
      requestBody,
      null,
      null
    )
  }
}

function completionFailure(
  providerFailure: ProviderFailure,
  requestBody: unknown,
  responseBody: unknown | null,
  status: number | null
): Extract<ModelCompletionOutcome, { ok: false }> {
  return {
    ok: false,
    failure: { ...providerFailure, retryable: isRetryable(providerFailure.code) },
    requestBody,
    responseBody,
    status
  }
}

function isRetryable(code: ModelFailureCode): boolean {
  return ['rate-limited', 'provider-error', 'network', 'timeout'].includes(code)
}

function redactProviderFailure(
  providerFailure: ProviderFailure,
  headers: Record<string, string>
): ProviderFailure {
  const secrets = credentialSecrets(headers)
  return {
    ...providerFailure,
    message: redactString(providerFailure.message, secrets)
  }
}

function credentialSecrets(headers: Record<string, string>): string[] {
  return Object.entries(headers).flatMap(([name, value]) => {
    if (name.toLowerCase() === 'x-api-key') return [value]
    if (name.toLowerCase() === 'authorization') {
      return [value, value.replace(/^Bearer\s+/i, '')]
    }
    return []
  })
}

function redactProviderPayload(value: unknown, headers: Record<string, string>): unknown {
  const secrets = credentialSecrets(headers)
  if (typeof value === 'string') return redactString(value, secrets)
  if (Array.isArray(value)) return value.map((item) => redactProviderPayload(item, headers))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redactString(key, secrets),
      redactProviderPayload(item, headers)
    ])
  )
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((result, secret) => result.split(secret).join('[redacted]'), value)
}

function probeResult(response: SendResult): ProviderProbeResult {
  if (response.ok) return { state: 'success' }
  // A parameter or capability error means the endpoint answered but cannot run text requests.
  if (response.failure.code === 'invalid-request') {
    return { state: 'unsupported', failure: response.failure }
  }
  return { state: 'failed', failure: response.failure }
}

export function classifyResponse(
  status: number,
  body: unknown,
  text: string
): ProviderFailure | null {
  if (status >= 200 && status < 300) return null

  const message = readErrorMessage(body, text)
  if (status === 401 || status === 403 || readCode(body) === 'InvalidApiKey') {
    return failure('unauthorized', message ?? 'API key was rejected')
  }
  if (isModelMissing(body, message)) {
    return failure('model-not-found', message ?? 'Model does not exist on this endpoint')
  }
  if (status === 429) return failure('rate-limited', message ?? 'Request was rate limited')
  if (status >= 500) return failure('provider-error', message ?? `Endpoint returned ${status}`)
  if (status === 404) return failure('not-found', message ?? 'Endpoint path was not found')
  if (status === 400 || status === 422) {
    return failure('invalid-request', message ?? `Endpoint rejected the request with ${status}`)
  }
  return failure('unknown', message ?? `Endpoint returned ${status}`)
}

function failure(code: ModelFailureCode, message: string): ProviderFailure {
  return { code, message }
}

function readModelIds(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  const ids = data
    .map((entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id
        : null
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return ids
}

function readAssistantContent(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0]
  if (typeof first !== 'object' || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' && content.trim() ? content : null
}

function readCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { code?: unknown }).code
  if (typeof code === 'string') return code
  const nested = (body as { error?: unknown }).error
  if (typeof nested === 'object' && nested !== null) {
    const nestedCode = (nested as { code?: unknown }).code
    if (typeof nestedCode === 'string') return nestedCode
  }
  return null
}

function readErrorMessage(body: unknown, text: string): string | null {
  if (typeof body === 'object' && body !== null) {
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
    const nested = (body as { error?: unknown }).error
    if (typeof nested === 'object' && nested !== null) {
      const nestedMessage = (nested as { message?: unknown }).message
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim()
    }
  }
  const trimmed = text.trim()
  return trimmed ? trimmed.slice(0, 200) : null
}

function isModelMissing(body: unknown, message: string | null): boolean {
  const code = readCode(body)
  if (code === 'model_not_found') return true
  const combined = `${code ?? ''} ${message ?? ''}`
  return /model not exist|model_not_found|model does not exist/i.test(combined)
}
