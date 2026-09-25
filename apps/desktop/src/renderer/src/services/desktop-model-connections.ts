import type { ModelConnectionsDesktopApi } from '../../../preload/desktop-api'
import type {
  ModelConnection,
  ModelConnectionDraft,
  ModelConnectionTestResult,
  ModelConnectionsService,
  ModelFailure,
  ModelFailureCode,
  ModelOption,
  ModelProbeState,
  ModelProtocol,
  ModelTestResult,
  ModelTestState
} from '../models/model-connections'

export class ModelConnectionsError extends Error {
  constructor(
    readonly code: ModelFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'ModelConnectionsError'
  }
}

export class DesktopModelConnectionsService implements ModelConnectionsService {
  constructor(private readonly api: ModelConnectionsDesktopApi) {}

  async list(): Promise<ModelConnection[]> {
    const connections = await this.run(() => this.api.list())
    return connections.map(mapConnection)
  }

  async testConnection(draft: ModelConnectionDraft): Promise<ModelConnectionTestResult> {
    const result = await this.run(() => this.api.testConnection(draft))
    return result.ok ? { ok: true } : { ok: false, failure: mapFailure(result.failure) }
  }

  async discover(draft: ModelConnectionDraft): Promise<ModelOption[]> {
    const models = await this.run(() => this.api.discover(draft))
    return models.map(mapModel)
  }

  async refresh(connectionId: string): Promise<ModelOption[]> {
    const models = await this.run(() => this.api.refresh(connectionId))
    return models.map(mapModel)
  }

  async testModels(draft: ModelConnectionDraft, modelIds: string[]): Promise<ModelTestResult[]> {
    const results = await this.run(() => this.api.testModels(draft, [...modelIds]))
    return results.map(mapTestResult)
  }

  async testConnectionModels(connectionId: string, modelIds: string[]): Promise<ModelTestResult[]> {
    const results = await this.run(() => this.api.testConnectionModels(connectionId, [...modelIds]))
    return results.map(mapTestResult)
  }

  async setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void> {
    await this.run(() => this.api.setModelEnabled(connectionId, modelId, enabled))
  }

  async setDefaultImageModel(
    model: { connectionId: string; modelId: string } | null
  ): Promise<void> {
    await this.run(() => this.api.setDefaultImageModel(model))
  }

  async getDefaultImageModel(): Promise<{ connectionId: string; modelId: string } | null> {
    return this.run(() => this.api.getDefaultImageModel())
  }

  async add(draft: ModelConnectionDraft, models: ModelOption[]): Promise<ModelConnection> {
    const connection = await this.run(() =>
      this.api.add(
        draft,
        models.map((model) => ({ ...model }))
      )
    )
    return mapConnection(connection)
  }

  async delete(connectionId: string): Promise<void> {
    await this.run(() => this.api.delete(connectionId))
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw mapError(error)
    }
  }
}

const FAILURE_CODES: readonly ModelFailureCode[] = [
  'unauthorized',
  'not-found',
  'model-not-found',
  'rate-limited',
  'provider-error',
  'network',
  'timeout',
  'invalid-request',
  'invalid-response',
  'secret-unavailable',
  'storage-error',
  'unknown'
]

const PROTOCOLS: readonly ModelProtocol[] = ['openai-compatible', 'anthropic']
const TEST_STATES: readonly ModelTestState[] = [
  'untested',
  'testing',
  'success',
  'failed',
  'unsupported'
]
const PROBE_STATES: readonly ModelProbeState[] = ['success', 'failed', 'unsupported']

function mapError(error: unknown): ModelConnectionsError {
  if (error instanceof ModelConnectionsError) return error
  if (isRecord(error) && isFailureCode(error.code)) {
    return new ModelConnectionsError(
      error.code,
      typeof error.message === 'string' ? error.message : '模型连接请求失败'
    )
  }
  return new ModelConnectionsError(
    'unknown',
    error instanceof Error ? error.message : String(error)
  )
}

function mapFailure(value: unknown): ModelFailure {
  if (isRecord(value) && isFailureCode(value.code)) {
    return {
      code: value.code,
      message: typeof value.message === 'string' ? value.message : '模型连接请求失败'
    }
  }
  return { code: 'unknown', message: '模型连接请求失败' }
}

function mapConnection(value: unknown): ModelConnection {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isProtocol(value.protocol) ||
    typeof value.baseUrl !== 'string' ||
    typeof value.apiKeyHint !== 'string' ||
    typeof value.expanded !== 'boolean' ||
    !Array.isArray(value.models)
  ) {
    throw new ModelConnectionsError('invalid-response', '模型连接响应格式不正确')
  }
  return {
    id: value.id,
    name: value.name,
    protocol: value.protocol,
    baseUrl: value.baseUrl,
    apiKeyHint: value.apiKeyHint,
    expanded: value.expanded,
    models: value.models.map(mapModel)
  }
}

function mapModel(value: unknown): ModelOption {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.enabled !== 'boolean' ||
    !isTestState(value.testState)
  ) {
    throw new ModelConnectionsError('invalid-response', '模型列表响应格式不正确')
  }
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    testState: value.testState,
    ...(isRecord(value.capabilities)
      ? { capabilities: value.capabilities as ModelOption['capabilities'] }
      : {}),
    ...(Array.isArray(value.probeCandidates)
      ? {
          probeCandidates: value.probeCandidates.filter(
            (candidate): candidate is NonNullable<ModelOption['probeCandidates']>[number] =>
              ['text', 'reasoning', 'vision', 'image_generation'].includes(String(candidate))
          )
        }
      : {}),
    ...(Array.isArray(value.catalogLabels)
      ? {
          catalogLabels: value.catalogLabels.filter(
            (label): label is string => typeof label === 'string'
          )
        }
      : {}),
    kind: value.kind === 'image' ? 'image' : 'chat',
    ...(typeof value.imageInputEnabled === 'boolean'
      ? { imageInputEnabled: value.imageInputEnabled }
      : {}),
    ...(typeof value.imageGenerationEnabled === 'boolean'
      ? { imageGenerationEnabled: value.imageGenerationEnabled }
      : {}),
    imageGenerationApi: value.imageGenerationApi === 'token-plan' ? 'token-plan' : 'openai-images'
  }
}

function mapTestResult(value: unknown): ModelTestResult {
  if (!isRecord(value) || typeof value.modelId !== 'string' || !isProbeState(value.state)) {
    throw new ModelConnectionsError('invalid-response', '模型测试响应格式不正确')
  }
  return {
    modelId: value.modelId,
    state: value.state,
    ...(isRecord(value.capabilities)
      ? { capabilities: value.capabilities as ModelTestResult['capabilities'] }
      : {})
  }
}

function isProtocol(value: unknown): value is ModelProtocol {
  return PROTOCOLS.includes(value as ModelProtocol)
}

function isTestState(value: unknown): value is ModelTestState {
  return TEST_STATES.includes(value as ModelTestState)
}

function isProbeState(value: unknown): value is ModelProbeState {
  return PROBE_STATES.includes(value as ModelProbeState)
}

function isFailureCode(value: unknown): value is ModelFailureCode {
  return FAILURE_CODES.includes(value as ModelFailureCode)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
