import type { ModelFailureCode } from '@actiondriver/model-connections'
import type { ProviderFailure, ProviderProbeResult } from './provider-types'

export type SendResult =
  | { ok: true; value: { status: number; body: unknown; text: string } }
  | { ok: false; failure: ProviderFailure }

export function failure(code: ModelFailureCode, message: string): ProviderFailure {
  return { code, message }
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

export function isRetryable(code: ModelFailureCode): boolean {
  return ['rate-limited', 'provider-error', 'network', 'timeout'].includes(code)
}

export function probeResult(response: SendResult): ProviderProbeResult {
  if (response.ok) return { state: 'success' }
  // A parameter or capability error means the endpoint answered but cannot run text requests.
  if (response.failure.code === 'invalid-request') {
    return { state: 'unsupported', failure: response.failure }
  }
  return { state: 'failed', failure: response.failure }
}

export function redactProviderFailure(
  providerFailure: ProviderFailure,
  headers: Record<string, string>
): ProviderFailure {
  const secrets = credentialSecrets(headers)
  return {
    ...providerFailure,
    message: redactString(providerFailure.message, secrets)
  }
}

export function redactProviderPayload(value: unknown, headers: Record<string, string>): unknown {
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

function credentialSecrets(headers: Record<string, string>): string[] {
  return Object.entries(headers).flatMap(([name, value]) => {
    if (name.toLowerCase() === 'x-api-key') return [value]
    if (name.toLowerCase() === 'authorization') {
      return [value, value.replace(/^Bearer\s+/i, '')]
    }
    return []
  })
}

function redactString(value: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((result, secret) => result.split(secret).join('[redacted]'), value)
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

export function isModelMissing(body: unknown, message: string | null): boolean {
  const code = readCode(body)
  if (code === 'model_not_found') return true
  const combined = `${code ?? ''} ${message ?? ''}`
  return /model not exist|model_not_found|model does not exist/i.test(combined)
}
