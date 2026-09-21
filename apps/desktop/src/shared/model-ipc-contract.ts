export const MODEL_IPC_CHANNELS = {
  list: 'actiondriver:model-connections:list',
  testConnection: 'actiondriver:model-connections:test-connection',
  discover: 'actiondriver:model-connections:discover',
  refresh: 'actiondriver:model-connections:refresh',
  testModels: 'actiondriver:model-connections:test-models',
  testConnectionModels: 'actiondriver:model-connections:test-connection-models',
  setModelEnabled: 'actiondriver:model-connections:set-model-enabled',
  add: 'actiondriver:model-connections:add',
  delete: 'actiondriver:model-connections:delete'
} as const

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
  | 'invalid-request'
  | 'invalid-response'
  | 'secret-unavailable'
  | 'storage-error'
  | 'unknown'

export type ModelFailure = {
  code: ModelFailureCode
  message: string
}

/**
 * Transport DTOs never carry the plaintext API key. `apiKeyHint` is the only credential derived
 * value the Renderer may see.
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
