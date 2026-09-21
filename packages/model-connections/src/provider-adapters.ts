import type { HttpTransport } from './http-transport'
import { HttpTransportError } from './http-transport'
import type { ModelFailureCode, ModelProtocol } from './types'

export type ProviderFailure = {
  code: ModelFailureCode
  message: string
}

export type ProviderProbeResult =
  | { state: 'success' }
  | { state: 'unsupported'; failure: ProviderFailure }
  | { state: 'failed'; failure: ProviderFailure }

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; failure: ProviderFailure }

export interface ModelProviderAdapter {
  discover(input: ModelEndpoint): Promise<ProviderResult<string[]>>
  verifyConnection(input: ModelEndpoint): Promise<ProviderResult<null>>
  probeModel(input: ModelEndpoint & { modelId: string }): Promise<ProviderProbeResult>
}

export type ModelEndpoint = {
  baseUrl: string
  apiKey: string
}

export const CONNECTION_TEST_TIMEOUT_MS = 10_000
export const MODEL_REQUEST_TIMEOUT_MS = 15_000

const PROBE_MAX_TOKENS = 8
const ANTHROPIC_VERSION = '2023-06-01'
/** Sentinel model id used only to prove that endpoint and credentials work. */
const CONNECTION_PROBE_MODEL = 'connection-probe'

export function createModelProviderAdapter(
  protocol: ModelProtocol,
  transport: HttpTransport
): ModelProviderAdapter {
  return protocol === 'anthropic'
    ? createAnthropicAdapter(transport)
    : createOpenAiCompatibleAdapter(transport)
}

export function createOpenAiCompatibleAdapter(transport: HttpTransport): ModelProviderAdapter {
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
    if (classification) return { ok: false, failure: classification }
    return { ok: true, value: response }
  } catch (error) {
    if (error instanceof HttpTransportError) {
      return { ok: false, failure: failure(error.code, error.message) }
    }
    return {
      ok: false,
      failure: failure('unknown', error instanceof Error ? error.message : String(error))
    }
  }
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
