import type {
  ModelConnection,
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
  { id: 'gpt-5.2', name: 'gpt-5.2', enabled: true, testState: 'untested' },
  { id: 'gpt-5.2-mini', name: 'gpt-5.2-mini', enabled: true, testState: 'untested' },
  { id: 'gpt-4.1', name: 'gpt-4.1', enabled: false, testState: 'untested' }
]

const defaultConnections: ModelConnection[] = [
  {
    id: 'company-gateway',
    name: '公司模型网关',
    protocol: 'OpenAI 兼容',
    baseUrl: 'https://api.example.com/v1',
    expanded: true,
    models: discoveredModels
  },
  {
    id: 'anthropic-production',
    name: 'Anthropic 生产连接',
    protocol: 'OpenAI 兼容',
    baseUrl: 'https://anthropic.example.com/v1',
    expanded: false,
    models: [
      { id: 'claude-opus-4.1', name: 'claude-opus-4.1', enabled: true, testState: 'success' },
      { id: 'claude-sonnet-4', name: 'claude-sonnet-4', enabled: true, testState: 'success' }
    ]
  }
]

function cloneModels(models: ModelOption[]): ModelOption[] {
  return models.map((model) => ({ ...model }))
}

function cloneConnection(connection: ModelConnection): ModelConnection {
  return { ...connection, models: cloneModels(connection.models) }
}

export class MockModelConnectionsService implements ModelConnectionsService {
  private connections: ModelConnection[]
  private readonly delayMs: number
  private readonly modelResults: Record<string, boolean>

  constructor(options: MockModelConnectionsOptions = {}) {
    this.delayMs = options.delayMs ?? 120
    this.modelResults = options.modelResults ?? {}
    this.connections = (options.seed ?? defaultConnections).map(cloneConnection)
  }

  list(): ModelConnection[] {
    return this.connections.map(cloneConnection)
  }

  async testConnection(draft: ModelConnectionDraft): Promise<{ ok: boolean }> {
    await this.wait()
    return { ok: Boolean(draft.name.trim() && draft.baseUrl.trim() && draft.apiKey.trim()) }
  }

  async discover(draft: ModelConnectionDraft): Promise<ModelOption[]> {
    await this.wait()
    if (!draft.baseUrl.trim()) return []
    return cloneModels(discoveredModels)
  }

  async refresh(connectionId: string): Promise<ModelOption[]> {
    await this.wait()
    const connection = this.requireConnection(connectionId)
    const currentById = new Map(connection.models.map((model) => [model.id, model]))
    connection.models = discoveredModels.map((model) => ({
      ...model,
      enabled: currentById.get(model.id)?.enabled ?? model.enabled
    }))
    return cloneModels(connection.models)
  }

  async testModels(modelIds: string[]): Promise<ModelTestResult[]> {
    await this.wait()
    return modelIds.map((modelId) => ({
      modelId,
      state:
        (this.modelResults[modelId] ?? !modelId.startsWith('custom-model'))
          ? 'success'
          : 'failed'
    }))
  }

  async testConnectionModels(
    connectionId: string,
    modelIds: string[]
  ): Promise<ModelTestResult[]> {
    const results = await this.testModels(modelIds)
    const resultById = new Map(results.map((result) => [result.modelId, result.state]))
    const connection = this.requireConnection(connectionId)
    connection.models = connection.models.map((model) => {
      const result = resultById.get(model.id)
      return result ? { ...model, testState: result } : model
    })
    return results
  }

  async setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void> {
    await this.wait()
    const model = this.requireConnection(connectionId).models.find((item) => item.id === modelId)
    if (!model) throw new Error(`Unknown model: ${modelId}`)
    model.enabled = enabled
  }

  async add(draft: ModelConnectionDraft, models: ModelOption[]): Promise<ModelConnection> {
    await this.wait()
    const baseId = draft.name
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
      protocol: 'OpenAI 兼容',
      baseUrl: draft.baseUrl.trim(),
      expanded: true,
      models: cloneModels(models)
    }
    this.connections.push(connection)
    return cloneConnection(connection)
  }

  async delete(connectionId: string): Promise<void> {
    await this.wait()
    this.connections = this.connections.filter((connection) => connection.id !== connectionId)
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
