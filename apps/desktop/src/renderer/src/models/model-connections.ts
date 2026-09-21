export type ModelTestState = 'untested' | 'testing' | 'success' | 'failed'

export interface ModelOption {
  id: string
  name: string
  enabled: boolean
  testState: ModelTestState
}

export interface ModelConnectionDraft {
  name: string
  baseUrl: string
  apiKey: string
}

export interface ModelConnection {
  id: string
  name: string
  protocol: 'OpenAI 兼容'
  baseUrl: string
  expanded: boolean
  models: ModelOption[]
}

export interface ModelTestResult {
  modelId: string
  state: Extract<ModelTestState, 'success' | 'failed'>
}

export interface ModelConnectionsService {
  list(): ModelConnection[]
  testConnection(draft: ModelConnectionDraft): Promise<{ ok: boolean }>
  discover(draft: ModelConnectionDraft): Promise<ModelOption[]>
  refresh(connectionId: string): Promise<ModelOption[]>
  testModels(modelIds: string[]): Promise<ModelTestResult[]>
  testConnectionModels(connectionId: string, modelIds: string[]): Promise<ModelTestResult[]>
  setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void>
  add(draft: ModelConnectionDraft, models: ModelOption[]): Promise<ModelConnection>
  delete(connectionId: string): Promise<void>
}
