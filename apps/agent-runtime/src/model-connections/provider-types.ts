import type {
  ModelCompletionEvent,
  ModelCompletionOutcome,
  ModelFailureCode,
  ModelInputMessage
} from '@actiondriver/model-connections'
import type { ToolDefinition } from '@actiondriver/runtime-contracts'
import type { ImageAssetRef } from '@actiondriver/contracts'

export type ImageResolver = (asset: ImageAssetRef) => Promise<{
  bytes: Uint8Array
  mimeType: ImageAssetRef['mimeType']
}>

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

/** Smallest request that still proves an endpoint can run a text completion. */
export const PROBE_MAX_TOKENS = 8
