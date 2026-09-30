import type { ModelProtocol } from '@action-driver/model-connections'
import type { HttpTransport } from './http-transport'
import { createAnthropicAdapter } from './anthropic-adapter'
import {
  createOpenAiCompatibleAdapter,
  defaultOpenAiClientFactory
} from './openai-compatible-adapter'
import type { ImageResolver, ModelProviderAdapter, OpenAiClientFactory } from './provider-types'

export { createAnthropicAdapter } from './anthropic-adapter'
export { createOpenAiCompatibleAdapter } from './openai-compatible-adapter'
export { classifyResponse } from './provider-failures'

export type {
  ImageResolver,
  ModelEndpoint,
  ModelProviderAdapter,
  OpenAiClientFactory,
  OpenAiClientLike,
  OpenAiClientOptions,
  OpenAiStreamChunk,
  ProviderCompletionInput,
  ProviderFailure,
  ProviderProbeResult,
  ProviderResult
} from './provider-types'

export {
  CONNECTION_TEST_TIMEOUT_MS,
  MODEL_REQUEST_TIMEOUT_MS,
  ModelStreamError
} from './provider-types'

export function createModelProviderAdapter(
  protocol: ModelProtocol,
  transport: HttpTransport,
  openAiClientFactory: OpenAiClientFactory = defaultOpenAiClientFactory,
  imageResolver?: ImageResolver
): ModelProviderAdapter {
  return protocol === 'anthropic'
    ? createAnthropicAdapter(transport)
    : createOpenAiCompatibleAdapter(transport, openAiClientFactory, imageResolver)
}
