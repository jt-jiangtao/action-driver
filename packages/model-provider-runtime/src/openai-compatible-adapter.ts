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
import type { ModelInputMessage, ModelUsage } from '@action-driver/model-connections'
import type { ToolDefinition } from '@action-driver/runtime-contracts'
import {
  classifyResponse,
  failure,
  isModelMissing,
  probeResult,
  redactProviderFailure
} from './provider-failures'
import { completionFailure, normalizeBaseUrl, send, sendCompletion } from './provider-http'
import {
  CONNECTION_TEST_TIMEOUT_MS,
  MODEL_REQUEST_TIMEOUT_MS,
  ModelStreamError,
  PROBE_MAX_TOKENS,
  type ImageResolver,
  type ModelProviderAdapter,
  type OpenAiClientFactory,
  type OpenAiClientLike,
  type OpenAiStreamChunk,
  type ProviderCompletionInput,
  type ProviderFailure
} from './provider-types'

export function createOpenAiCompatibleAdapter(
  transport: HttpTransport,
  openAiClientFactory: OpenAiClientFactory = defaultOpenAiClientFactory,
  imageResolver?: ImageResolver
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
      const requestBody = await streamRequestBody(
        modelId,
        messages,
        tools,
        parameters,
        imageResolver
      )
      const safeRequestBody = redactImageData(requestBody)
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
      const knownToolNames = new Set(tools.map((tool) => tool.modelName))
      const preparingToolIndexes = new Set<number>()
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
            if (
              !choice?.finish_reason &&
              knownToolNames.has(current.modelName) &&
              !preparingToolIndexes.has(toolCall.index)
            ) {
              preparingToolIndexes.add(toolCall.index)
              yield {
                kind: 'tool-call-preparing',
                index: toolCall.index,
                modelName: current.modelName
              }
            }
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
      yield {
        kind: 'end',
        result,
        content,
        finishReason,
        usage,
        requestBody: safeRequestBody,
        responseBody,
        status
      }
    },
    async complete({ baseUrl, apiKey, modelId, messages, parameters }, signal) {
      const requestBody = {
        model: modelId,
        messages: await toOpenAiMessages(messages, imageResolver),
        ...(parameters.temperature === undefined ? {} : { temperature: parameters.temperature }),
        ...(parameters.maxTokens === undefined ? {} : { max_tokens: parameters.maxTokens }),
        stream: false
      }
      if (signal?.aborted) {
        return completionFailure(
          failure('cancelled', 'Model request was cancelled'),
          redactImageData(requestBody),
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
        redactImageData(requestBody)
      )
      if (!response.ok) return response

      const content = readAssistantContent(response.value.body)
      if (!content) {
        return completionFailure(
          failure('invalid-response', 'Model response is missing assistant text'),
          redactImageData(requestBody),
          response.value.body,
          response.value.status
        )
      }
      return {
        ok: true,
        value: {
          content,
          providerProtocol: 'openai-compatible',
          requestBody: redactImageData(requestBody),
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

export const defaultOpenAiClientFactory: OpenAiClientFactory = (options) =>
  new OpenAI(options) as unknown as OpenAiClientLike

async function streamRequestBody(
  modelId: string,
  messages: ProviderCompletionInput['messages'],
  tools: ToolDefinition[],
  parameters: ProviderCompletionInput['parameters'],
  imageResolver?: ImageResolver
): Promise<Record<string, unknown>> {
  return {
    model: modelId,
    messages: await toOpenAiMessages(messages, imageResolver),
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

async function toOpenAiMessages(
  messages: ModelInputMessage[],
  imageResolver?: ImageResolver
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(
    messages.map(async (message) => {
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
      if (message.role === 'user' && Array.isArray(message.content)) {
        const content = await Promise.all(
          message.content.map(async (part) => {
            if (part.kind === 'text') return { type: 'text', text: part.text }
            // Attached documents reach the model as a named file reference; the
            // bytes stay in the session workspace for the script tools.
            if (part.kind === 'document')
              return {
                type: 'text',
                text: `[附件] ${part.file.name}（${part.file.mimeType}）`
              }
            if (part.kind !== 'image')
              throw new ModelStreamError('invalid-request', 'Unsupported user message content')
            if (!imageResolver)
              throw new ModelStreamError('invalid-request', 'Image input is unavailable')
            const image = await imageResolver(part.asset)
            return {
              type: 'image_url',
              image_url: {
                url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`
              }
            }
          })
        )
        return { role: 'user', content }
      }
      return message
    })
  )
}

function redactImageData(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('data:image/')) return '[image bytes omitted]'
  if (Array.isArray(value)) return value.map(redactImageData)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactImageData(nested)])
    )
  return value
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
