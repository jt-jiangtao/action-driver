import type {
  ModelConnection,
  ModelConnectionTestResult,
  ModelConnectionDraft,
  ModelConnectionsService,
  ModelOption,
  ModelTestResult
} from '../models/model-connections'

interface MockModelConnectionsOptions {
  delayMs?: number
  modelResults?: Record<string, boolean>
  seed?: ModelConnection[]
}

const discoveredModels: ModelOption[] = [
  {
    id: 'gpt-5.2',
    name: 'gpt-5.2',
    enabled: true,
    testState: 'success',
    capabilities: {
      text: { state: 'success', source: 'probe' },
      vision: { state: 'success', source: 'probe' }
    }
  },
  {
    id: 'gpt-5.2-mini',
    name: 'gpt-5.2-mini',
    enabled: true,
    testState: 'success',
    capabilities: { text: { state: 'success', source: 'probe' } }
  },
  { id: 'gpt-4.1', name: 'gpt-4.1', enabled: false, testState: 'untested' }
]

const defaultConnections: ModelConnection[] = [
  {
    id: 'company-gateway',
    name: '公司模型网关',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyHint: '••••1234',
    expanded: true,
    models: discoveredModels
  },
  {
    id: 'anthropic-production',
    name: 'Anthropic 生产连接',
    protocol: 'anthropic',
    baseUrl: 'https://anthropic.example.com/v1',
    apiKeyHint: '••••5678',
    expanded: false,
    models: [
      {
        id: 'claude-opus-4.1',
        name: 'claude-opus-4.1',
        enabled: true,
        testState: 'success',
        capabilities: { text: { state: 'success', source: 'probe' } }
      },
      {
        id: 'claude-sonnet-4',
        name: 'claude-sonnet-4',
        enabled: true,
        testState: 'success',
        capabilities: { text: { state: 'success', source: 'probe' } }
      }
    ]
  }
]

function cloneModels(models: ModelOption[]): ModelOption[] {
  return models.map((model) => ({
    ...model,
    probeCandidates:
      model.probeCandidates ??
      (model.catalogLabels?.length
        ? []
        : Object.keys(model.capabilities ?? {}).length
          ? (Object.keys(model.capabilities ?? {}) as ModelOption['probeCandidates'])
          : ['text', 'vision', 'image_generation']),
    kind: model.kind ?? (model.imageGenerationEnabled ? 'image' : 'chat')
  }))
}

function cloneConnection(connection: ModelConnection): ModelConnection {
  return { ...connection, models: cloneModels(connection.models) }
}

export class MockModelConnectionsService implements ModelConnectionsService {
  private connections: ModelConnection[]
  private defaultImageModel: { connectionId: string; modelId: string } | null = null
  private readonly delayMs: number
  private readonly modelResults: Record<string, boolean>

  constructor(options: MockModelConnectionsOptions = {}) {
    this.delayMs = options.delayMs ?? 120
    this.modelResults = options.modelResults ?? {}
    this.connections = (options.seed ?? defaultConnections).map(cloneConnection)
  }

  async list(): Promise<ModelConnection[]> {
    return this.connections.map(cloneConnection)
  }

  async testConnection(draft: ModelConnectionDraft): Promise<ModelConnectionTestResult> {
    await this.wait()
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.apiKey.trim()) {
      return { ok: false, failure: { code: 'invalid-request', message: '连接信息不完整' } }
    }
    return { ok: true }
  }

  async discover(draft: ModelConnectionDraft): Promise<ModelOption[]> {
    await this.wait()
    if (!draft.baseUrl.trim()) return []
    return discoveredModels.map((model) => ({ ...model, testState: 'untested' }))
  }

  async refresh(connectionId: string): Promise<ModelOption[]> {
    await this.wait()
    const connection = this.requireConnection(connectionId)
    const currentById = new Map(connection.models.map((model) => [model.id, model]))
    connection.models = discoveredModels.map((model) => ({
      ...model,
      enabled: currentById.get(model.id)?.enabled ?? model.enabled,
      imageInputEnabled: currentById.get(model.id)?.imageInputEnabled ?? false,
      imageGenerationEnabled: currentById.get(model.id)?.imageGenerationEnabled ?? false,
      kind: currentById.get(model.id)?.kind ?? 'chat',
      imageGenerationApi: currentById.get(model.id)?.imageGenerationApi ?? 'openai-images'
    }))
    this.clearInvalidImageDefault()
    return cloneModels(connection.models)
  }

  async testModels(draft: ModelConnectionDraft, modelIds: string[]): Promise<ModelTestResult[]> {
    await this.wait()
    if (!draft.baseUrl.trim()) return []
    return modelIds.map((modelId) => {
      const success = this.modelResults[modelId] ?? !modelId.startsWith('custom-model')
      return {
        modelId,
        state: success ? 'success' : 'failed',
        capabilities: {
          text: { state: success ? 'success' : 'failed', source: 'probe' },
          ...(modelId.includes('image')
            ? {
                image_generation: {
                  state: success ? ('success' as const) : ('failed' as const),
                  source: 'probe' as const
                }
              }
            : {})
        }
      }
    })
  }

  async testConnectionModels(connectionId: string, modelIds: string[]): Promise<ModelTestResult[]> {
    const connection = this.requireConnection(connectionId)
    const results = await this.testModels(
      {
        name: connection.name,
        protocol: connection.protocol,
        baseUrl: connection.baseUrl,
        apiKey: 'mock-connection-key'
      },
      modelIds
    )
    const resultById = new Map(results.map((result) => [result.modelId, result]))
    connection.models = connection.models.map((model) => {
      const result = resultById.get(model.id)
      return result
        ? { ...model, testState: result.state, capabilities: result.capabilities ?? {} }
        : model
    })
    this.clearInvalidImageDefault()
    return results
  }

  async setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void> {
    await this.wait()
    const model = this.requireConnection(connectionId).models.find((item) => item.id === modelId)
    if (!model) throw new Error(`Unknown model: ${modelId}`)
    model.enabled = enabled
    this.clearInvalidImageDefault()
  }

  async setDefaultImageModel(
    model: { connectionId: string; modelId: string } | null
  ): Promise<void> {
    if (model) {
      const selected = this.requireConnection(model.connectionId).models.find(
        (item) => item.id === model.modelId
      )
      if (!selected?.enabled || selected.capabilities?.image_generation?.state !== 'success')
        throw new Error('Image model is unavailable')
    }
    this.defaultImageModel = model
  }

  async getDefaultImageModel(): Promise<{ connectionId: string; modelId: string } | null> {
    return this.defaultImageModel
  }

  async add(draft: ModelConnectionDraft, models: ModelOption[]): Promise<ModelConnection> {
    await this.wait()
    const baseId =
      draft.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'model-connection'
    let id = baseId
    let suffix = 2
    while (this.connections.some((connection) => connection.id === id)) {
      id = `${baseId}-${suffix}`
      suffix += 1
    }
    const connection: ModelConnection = {
      id,
      name: draft.name.trim(),
      protocol: draft.protocol,
      baseUrl: draft.baseUrl.trim(),
      apiKeyHint: `••••${draft.apiKey.trim().slice(-4)}`,
      expanded: true,
      models: cloneModels(models)
    }
    this.connections.push(connection)
    return cloneConnection(connection)
  }

  async delete(connectionId: string): Promise<void> {
    await this.wait()
    this.connections = this.connections.filter((connection) => connection.id !== connectionId)
    this.clearInvalidImageDefault()
  }

  private clearInvalidImageDefault(): void {
    const selected = this.defaultImageModel
    if (!selected) return
    const model = this.connections
      .find((connection) => connection.id === selected.connectionId)
      ?.models.find((item) => item.id === selected.modelId)
    if (!model?.enabled || model.capabilities?.image_generation?.state !== 'success')
      this.defaultImageModel = null
  }

  private requireConnection(connectionId: string): ModelConnection {
    const connection = this.connections.find((item) => item.id === connectionId)
    if (!connection) throw new Error(`Unknown model connection: ${connectionId}`)
    return connection
  }

  private async wait(): Promise<void> {
    if (this.delayMs <= 0) return
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
  }
}
