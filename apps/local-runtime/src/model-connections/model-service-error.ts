import { ModelServiceError } from '@action-driver/model-connections'
import type { ProviderFailure } from '@action-driver/model-provider-runtime/provider-adapters'
import { SecretCipherUnavailableError } from './credential-cipher'
import { ModelStorageError } from './store'

export function toServiceError(failure: ProviderFailure | unknown): ModelServiceError {
  if (failure instanceof ModelServiceError) return failure
  if (failure instanceof ModelStorageError) {
    return new ModelServiceError('storage-error', failure.message)
  }
  if (failure instanceof SecretCipherUnavailableError) {
    return new ModelServiceError('secret-unavailable', failure.message)
  }
  if (isProviderFailure(failure)) {
    return new ModelServiceError(failure.code, failure.message)
  }
  return new ModelServiceError(
    'unknown',
    failure instanceof Error ? failure.message : String(failure)
  )
}

function isProviderFailure(value: unknown): value is ProviderFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}
