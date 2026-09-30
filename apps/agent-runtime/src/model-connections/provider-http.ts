import type { ModelCompletionOutcome } from '@action-driver/model-connections'
import type { HttpTransport } from './http-transport'
import { HttpTransportError } from './http-transport'
import {
  classifyResponse,
  failure,
  isRetryable,
  redactProviderFailure,
  redactProviderPayload,
  type SendResult
} from './provider-failures'
import type { ProviderFailure } from './provider-types'

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export async function send(
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

export async function sendCompletion(
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

export function completionFailure(
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
