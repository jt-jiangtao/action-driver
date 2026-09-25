import type { MessageContentPart, ModelRef } from '@actiondriver/contracts'
import type { ToolDefinition } from '@actiondriver/runtime-contracts'

export type ModelProtocol = 'openai-compatible' | 'anthropic'

export type ImageGenerationApi = 'openai-images' | 'token-plan'
export type ModelKind = 'chat' | 'image'

export type ModelCapability = 'text' | 'reasoning' | 'vision' | 'image_generation'
export type CapabilityState =
  | 'untested'
  | 'testing'
  | 'success'
  | 'unsupported'
  | 'failed'
  | 'inconclusive'
export type CapabilitySource = 'catalog' | 'probe' | 'legacy'
export type ModelCapabilityResultDto = {
  state: CapabilityState
  source: CapabilitySource
  testedAt?: string | undefined
  failure?: ModelFailure | undefined
}

export type ModelTestState = 'untested' | 'testing' | 'success' | 'failed' | 'unsupported'

export type ModelProbeState = Extract<ModelTestState, 'success' | 'failed' | 'unsupported'>

export type ModelFailureCode =
  | 'unauthorized'
  | 'not-found'
  | 'model-not-found'
  | 'rate-limited'
  | 'provider-error'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'invalid-request'
  | 'invalid-response'
  | 'secret-unavailable'
  | 'storage-error'
  | 'unknown'

export type ModelFailure = {
  code: ModelFailureCode
  message: string
}

export type ModelCompletionRequest = {
  model: ModelRef
  requestId: string
  taskId: string
  messages: ModelInputMessage[]
  tools?: ToolDefinition[]
  parameters: { temperature?: number; maxTokens?: number }
}

export type ProviderToolCall = {
  providerCallId: string
  modelName: string
  arguments: Record<string, unknown>
}

export type ModelInputMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | MessageContentPart[] }
  | { role: 'assistant'; toolCalls: ProviderToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export type ModelTerminal =
  | { kind: 'final-text'; content: string }
  | { kind: 'tool-calls'; calls: ProviderToolCall[] }

export type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type ModelCompletionEvent =
  | { kind: 'content'; delta: string }
  | { kind: 'tool-call-preparing'; index: number; modelName: string }
  | {
      kind: 'end'
      result?: ModelTerminal
      content: string
      finishReason: string | null
      usage: ModelUsage | null
      requestBody: unknown
      responseBody: unknown
      status: number
    }

export type ModelCompletionOutcome =
  | {
      ok: true
      value: {
        content: string
        providerProtocol: 'openai-compatible'
        requestBody: unknown
        responseBody: unknown
        status: number
      }
    }
  | {
      ok: false
      failure: ModelFailure & { retryable: boolean }
      requestBody: unknown
      responseBody: unknown | null
      status: number | null
    }

/**
 * Transport DTOs never carry the plaintext API key. `apiKeyHint` is the only credential derived
 * value any client may see.
 */
export type ModelConnectionDraftDto = {
  name: string
  protocol: ModelProtocol
  baseUrl: string
  apiKey: string
}

export type ModelOptionDto = {
  id: string
  name: string
  kind?: ModelKind | undefined
  enabled: boolean
  testState: ModelTestState
  imageInputEnabled?: boolean | undefined
  imageGenerationEnabled?: boolean | undefined
  imageGenerationApi?: ImageGenerationApi | undefined
  capabilities?: Partial<Record<ModelCapability, ModelCapabilityResultDto>> | undefined
  catalogLabels?: string[] | undefined
}

export type ModelConnectionDto = {
  id: string
  name: string
  protocol: ModelProtocol
  baseUrl: string
  apiKeyHint: string
  expanded: boolean
  models: ModelOptionDto[]
}

export type ModelConnectionTestResultDto = { ok: true } | { ok: false; failure: ModelFailure }

export type ModelTestResultDto = {
  modelId: string
  state: ModelProbeState
  capabilities?: Partial<Record<ModelCapability, ModelCapabilityResultDto>> | undefined
}

export type ModelTestRequestDto = {
  draft: ModelConnectionDraftDto
  modelIds: string[]
  imageModels?: { modelId: string; api: ImageGenerationApi }[] | undefined
}

export type ModelConnectionTestRequestDto = {
  connectionId: string
  modelIds: string[]
}

export type ModelSetEnabledRequestDto = {
  connectionId: string
  modelId: string
  enabled: boolean
}

export type ModelSetKindRequestDto = {
  connectionId: string
  modelId: string
  kind: ModelKind
}

export type ModelImageCapabilityRequestDto = {
  connectionId: string
  modelId: string
  kind: 'input' | 'generation'
  enabled: boolean
}

export type ModelImageGenerationApiRequestDto = {
  connectionId: string
  modelId: string
  api: ImageGenerationApi
}

export type ModelAddRequestDto = {
  draft: ModelConnectionDraftDto
  models: ModelOptionDto[]
}

export type ModelDeleteRequestDto = {
  connectionId: string
}

/** Stable read port implemented by Runtime model connection services. */
export interface ModelConnectionServicePort {
  list(): Promise<ModelConnectionDto[]>
  testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto>
  discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]>
  refresh(connectionId: string): Promise<ModelOptionDto[]>
  testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]>
  testConnectionModels(request: ModelConnectionTestRequestDto): Promise<ModelTestResultDto[]>
  setModelEnabled(request: ModelSetEnabledRequestDto): Promise<void>
  setModelKind(request: ModelSetKindRequestDto): Promise<void>
  setModelImageCapability(request: ModelImageCapabilityRequestDto): Promise<void>
  setModelImageGenerationApi(request: ModelImageGenerationApiRequestDto): Promise<void>
  setDefaultImageModel(model: ModelRef | null): Promise<void>
  getDefaultImageModel(): Promise<ModelRef | null>
  add(request: ModelAddRequestDto): Promise<ModelConnectionDto>
  delete(connectionId: string): Promise<void>
}

export interface ModelCompletionServicePort {
  complete(request: ModelCompletionRequest, signal?: AbortSignal): Promise<ModelCompletionOutcome>
  stream(request: ModelCompletionRequest, signal?: AbortSignal): AsyncIterable<ModelCompletionEvent>
}

export class ModelServiceError extends Error {
  constructor(
    readonly code: ModelFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'ModelServiceError'
  }
}
