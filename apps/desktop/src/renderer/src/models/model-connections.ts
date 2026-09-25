import type {
  ImageGenerationApi,
  ModelKind,
  ModelCapability,
  ModelCapabilityResultDto
} from '@actiondriver/model-connections'

export type ModelProtocol = 'openai-compatible' | 'anthropic'

export const MODEL_PROTOCOLS: readonly { id: ModelProtocol; label: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI 兼容' },
  { id: 'anthropic', label: 'Anthropic 兼容' }
]

export function modelProtocolLabel(protocol: ModelProtocol): string {
  return MODEL_PROTOCOLS.find((candidate) => candidate.id === protocol)?.label ?? protocol
}

export type ModelTestState = 'untested' | 'testing' | 'success' | 'failed' | 'unsupported'

export type ModelProbeState = 'success' | 'failed' | 'unsupported'

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

export interface ModelFailure {
  code: ModelFailureCode
  message: string
}

export interface ModelOption {
  id: string
  name: string
  kind?: ModelKind
  enabled: boolean
  testState: ModelTestState
  imageInputEnabled?: boolean
  imageGenerationEnabled?: boolean
  imageGenerationApi?: ImageGenerationApi
  capabilities?: Partial<Record<ModelCapability, ModelCapabilityResultDto>> | undefined
  probeCandidates?: ModelCapability[] | undefined
  chatCandidate?: boolean | undefined
  catalogLabels?: string[] | undefined
}

export interface ModelConnectionDraft {
  name: string
  protocol: ModelProtocol
  baseUrl: string
  apiKey: string
}

export interface ModelConnection {
  id: string
  name: string
  protocol: ModelProtocol
  baseUrl: string
  apiKeyHint: string
  expanded: boolean
  models: ModelOption[]
}

export interface ModelTestResult {
  modelId: string
  state: ModelProbeState
  capabilities?: Partial<Record<ModelCapability, ModelCapabilityResultDto>> | undefined
}

export type ModelConnectionTestResult = { ok: true } | { ok: false; failure: ModelFailure }

export interface ModelConnectionsService {
  list(): Promise<ModelConnection[]>
  testConnection(draft: ModelConnectionDraft): Promise<ModelConnectionTestResult>
  discover(draft: ModelConnectionDraft): Promise<ModelOption[]>
  refresh(connectionId: string): Promise<ModelOption[]>
  testModels(draft: ModelConnectionDraft, modelIds: string[]): Promise<ModelTestResult[]>
  testConnectionModels(connectionId: string, modelIds: string[]): Promise<ModelTestResult[]>
  setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void>
  setDefaultImageModel(model: { connectionId: string; modelId: string } | null): Promise<void>
  getDefaultImageModel(): Promise<{ connectionId: string; modelId: string } | null>
  add(draft: ModelConnectionDraft, models: ModelOption[]): Promise<ModelConnection>
  delete(connectionId: string): Promise<void>
}
