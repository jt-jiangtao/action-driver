import type { ModelRef } from '@actiondriver/contracts'
import type { ToolDefinition } from '@actiondriver/runtime-contracts'

export type ModelProtocol = 'openai-compatible' | 'anthropic'

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
  | { role: 'system' | 'user' | 'assistant'; content: string }
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
  enabled: boolean
  testState: ModelTestState
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
}

export type ModelTestRequestDto = {
  draft: ModelConnectionDraftDto
  modelIds: string[]
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

export type ModelAddRequestDto = {
  draft: ModelConnectionDraftDto
  models: ModelOptionDto[]
}

export type ModelDeleteRequestDto = {
  connectionId: string
}

export type ModelIpcError = ModelFailure

export type ModelIpcResponse<T> = { ok: true; value: T } | { ok: false; error: ModelIpcError }
