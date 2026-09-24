import type { HttpTransport } from './http-transport'
import type { ModelRef } from '@actiondriver/contracts'
import type { ImageResolver, OpenAiClientFactory, ProviderFailure } from './provider-adapters'
import { createModelProviderAdapter } from './provider-adapters'
import { createImageGenerationAdapter } from '../media/image-generation-adapter'
import type { SecretCipher } from './credential-cipher'
import { SecretCipherUnavailableError, apiKeyHint } from './credential-cipher'
import type { ModelConnectionStore, StoredModelConnection } from './store'
import { ModelStorageError } from './store'
import { ModelServiceError } from '@actiondriver/model-connections'
import type {
  ModelAddRequestDto,
  ModelConnectionDto,
  ModelConnectionDraftDto,
  ModelConnectionTestRequestDto,
  ModelConnectionTestResultDto,
  ModelCompletionOutcome,
  ModelCompletionEvent,
  ModelCompletionRequest,
  ModelOptionDto,
  ModelSetEnabledRequestDto,
  ModelImageCapabilityRequestDto,
  ModelTestRequestDto,
  ModelTestResultDto,
  ModelConnectionServicePort,
  ModelCompletionServicePort
} from '@actiondriver/model-connections'

export type ModelConnectionServiceOptions = {
  store: ModelConnectionStore
  cipher: SecretCipher
  transport: HttpTransport
  openAiClientFactory?: OpenAiClientFactory
  imageResolver?: ImageResolver
}

export class ModelConnectionService
  implements ModelConnectionServicePort, ModelCompletionServicePort
{
  constructor(private readonly options: ModelConnectionServiceOptions) {}

  async list(): Promise<ModelConnectionDto[]> {
    return this.read().map(toDto)
  }

  async complete(
    request: ModelCompletionRequest,
    signal?: AbortSignal
  ): Promise<ModelCompletionOutcome> {
    const connection = requireConnection(this.read(), request.model.connectionId)
    const model = connection.models.find((candidate) => candidate.id === request.model.modelId)
    if (!model) {
      throw new ModelServiceError('invalid-request', `Unknown model: ${request.model.modelId}`)
    }
    if (!model.enabled) {
      throw new ModelServiceError('invalid-request', `Model ${model.id} is disabled`)
    }
    if (model.testState === 'unsupported') {
      throw new ModelServiceError('invalid-request', `Model ${model.id} does not support text`)
    }
    if (model.testState !== 'success') {
      throw new ModelServiceError(
        'invalid-request',
        `Model ${model.id} has not passed text testing`
      )
    }
    if (connection.protocol !== 'openai-compatible') {
      throw new ModelServiceError('invalid-request', 'Agent 调用暂未接入')
    }
    requireVisionCapability(model, request.messages)

    const adapter = createModelProviderAdapter(
      connection.protocol,
      this.options.transport,
      this.options.openAiClientFactory,
      this.options.imageResolver
    )
    return await adapter.complete(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        modelId: model.id,
        messages: request.messages,
        ...(request.tools === undefined ? {} : { tools: request.tools }),
        parameters: request.parameters
      },
      signal
    )
  }

  async *stream(
    request: ModelCompletionRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelCompletionEvent> {
    const { connection, model } = this.requireRunnableModel(request)
    const adapter = createModelProviderAdapter(
      connection.protocol,
      this.options.transport,
      this.options.openAiClientFactory,
      this.options.imageResolver
    )
    yield* adapter.stream(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        modelId: model.id,
        messages: request.messages,
        ...(request.tools === undefined ? {} : { tools: request.tools }),
        parameters: request.parameters
      },
      signal
    )
  }

  async testConnection(draft: ModelConnectionDraftDto): Promise<ModelConnectionTestResultDto> {
    const validated = validateDraft(draft)
    const adapter = createModelProviderAdapter(validated.protocol, this.options.transport)
    const result = await adapter.verifyConnection({
      baseUrl: validated.baseUrl,
      apiKey: validated.apiKey
    })
    return result.ok ? { ok: true } : { ok: false, failure: result.failure }
  }

  async discover(draft: ModelConnectionDraftDto): Promise<ModelOptionDto[]> {
    const validated = validateDraft(draft)
    const adapter = createModelProviderAdapter(validated.protocol, this.options.transport)
    const result = await adapter.discover({
      baseUrl: validated.baseUrl,
      apiKey: validated.apiKey
    })
    if (!result.ok) throw toServiceError(result.failure)
    return result.value.map((id) => ({ id, name: id, enabled: true, testState: 'untested' }))
  }

  async refresh(connectionId: string): Promise<ModelOptionDto[]> {
    const connections = this.read()
    const connection = requireConnection(connections, connectionId)
    const adapter = createModelProviderAdapter(connection.protocol, this.options.transport)
    const result = await adapter.discover({
      baseUrl: connection.baseUrl,
      apiKey: this.decrypt(connection)
    })
    if (!result.ok) throw toServiceError(result.failure)
    const discovered = new Set(result.value)
    connection.models = [
      ...result.value.map((id) => mergeDiscoveredModel(connection, id)),
      ...connection.models.filter(
        (model) =>
          !discovered.has(model.id) &&
          (model.imageInputEnabled === true || model.imageGenerationEnabled === true)
      )
    ]
    this.write(connections)
    return connection.models.map((model) => ({ ...model }))
  }

  async testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]> {
    const validated = validateDraft(request.draft)
    return await this.probeModels(
      {
        baseUrl: validated.baseUrl,
        apiKey: validated.apiKey,
        protocol: validated.protocol
      },
      request.modelIds
    )
  }

  async testConnectionModels(
    request: ModelConnectionTestRequestDto
  ): Promise<ModelTestResultDto[]> {
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    const results = await this.probeModels(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        protocol: connection.protocol
      },
      request.modelIds
    )
    const stateById = new Map(results.map((result) => [result.modelId, result.state]))
    connection.models = connection.models.map((model) => {
      const state = stateById.get(model.id)
      return state ? { ...model, testState: state } : model
    })
    this.write(connections)
    return results
  }

  async setModelEnabled(request: ModelSetEnabledRequestDto): Promise<void> {
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    const model = connection.models.find((candidate) => candidate.id === request.modelId)
    if (!model) {
      throw new ModelServiceError('invalid-request', `Unknown model: ${request.modelId}`)
    }
    connection.models = connection.models.map((candidate) =>
      candidate.id === request.modelId ? { ...candidate, enabled: request.enabled } : candidate
    )
    this.write(connections)
  }

  async setModelImageCapability(request: ModelImageCapabilityRequestDto): Promise<void> {
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    if (request.enabled && connection.protocol !== 'openai-compatible')
      throw new ModelServiceError(
        'invalid-request',
        'Image capability requires an OpenAI compatible connection'
      )
    const model = connection.models.find((candidate) => candidate.id === request.modelId)
    if (!model) throw new ModelServiceError('invalid-request', `Unknown model: ${request.modelId}`)
    const field = request.kind === 'input' ? 'imageInputEnabled' : 'imageGenerationEnabled'
    connection.models = connection.models.map((candidate) =>
      candidate.id === request.modelId ? { ...candidate, [field]: request.enabled } : candidate
    )
    this.write(connections)
  }

  async setDefaultImageModel(model: ModelRef | null): Promise<void> {
    if (model) {
      const connection = requireConnection(this.read(), model.connectionId)
      const chosen = connection.models.find((candidate) => candidate.id === model.modelId)
      if (
        connection.protocol !== 'openai-compatible' ||
        !chosen?.enabled ||
        !chosen.imageGenerationEnabled
      )
        throw new ModelServiceError('invalid-request', 'Model is not enabled for image generation')
    }
    this.options.store.writeDefaultImageModel(model)
  }

  async getDefaultImageModel(): Promise<ModelRef | null> {
    return this.options.store.readDefaultImageModel()
  }

  async generateImage(
    request: { model: ModelRef; prompt: string },
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const selected = await this.getDefaultImageModel()
    if (
      !selected ||
      selected.connectionId !== request.model.connectionId ||
      selected.modelId !== request.model.modelId
    )
      throw new ModelServiceError('invalid-request', 'Default image model changed')
    const connection = requireConnection(this.read(), selected.connectionId)
    const model = connection.models.find((candidate) => candidate.id === selected.modelId)
    if (
      connection.protocol !== 'openai-compatible' ||
      !model?.enabled ||
      !model.imageGenerationEnabled
    )
      throw new ModelServiceError('invalid-request', 'Image model is unavailable')
    return createImageGenerationAdapter().generate(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        modelId: model.id,
        prompt: request.prompt
      },
      signal
    )
  }

  async add(request: ModelAddRequestDto): Promise<ModelConnectionDto> {
    const draft = validateDraft(request.draft)
    const connections = this.read()
    const connection: StoredModelConnection = {
      id: nextConnectionId(connections, draft.name),
      name: draft.name,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      apiKeyCipher: this.encrypt(draft.apiKey),
      apiKeyHint: apiKeyHint(draft.apiKey),
      expanded: true,
      models: request.models.map((model) => ({ ...model }))
    }
    this.write([...connections, connection])
    return toDto(connection)
  }

  async delete(connectionId: string): Promise<void> {
    const connections = this.read()
    requireConnection(connections, connectionId)
    this.write(connections.filter((connection) => connection.id !== connectionId))
  }

  private async probeModels(
    endpoint: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
    modelIds: readonly string[]
  ): Promise<ModelTestResultDto[]> {
    const adapter = createModelProviderAdapter(endpoint.protocol, this.options.transport)
    const results: ModelTestResultDto[] = []
    for (const modelId of modelIds) {
      const result = await adapter.probeModel({ ...endpoint, modelId })
      results.push({ modelId, state: result.state })
    }
    return results
  }

  private read(): StoredModelConnection[] {
    try {
      return this.options.store.read()
    } catch (error) {
      throw toServiceError(error)
    }
  }

  private write(connections: readonly StoredModelConnection[]): void {
    try {
      this.options.store.write(connections)
    } catch (error) {
      throw toServiceError(error)
    }
  }

  private encrypt(apiKey: string): string {
    try {
      return this.options.cipher.encrypt(apiKey)
    } catch (error) {
      throw toServiceError(error)
    }
  }

  private decrypt(connection: StoredModelConnection): string {
    try {
      return this.options.cipher.decrypt(connection.apiKeyCipher)
    } catch (error) {
      throw toServiceError(error)
    }
  }

  private requireRunnableModel(request: ModelCompletionRequest): {
    connection: StoredModelConnection
    model: StoredModelConnection['models'][number]
  } {
    const connection = requireConnection(this.read(), request.model.connectionId)
    const model = connection.models.find((candidate) => candidate.id === request.model.modelId)
    if (!model) {
      throw new ModelServiceError('invalid-request', `Unknown model: ${request.model.modelId}`)
    }
    if (!model.enabled) {
      throw new ModelServiceError('invalid-request', `Model ${model.id} is disabled`)
    }
    if (model.testState === 'unsupported') {
      throw new ModelServiceError('invalid-request', `Model ${model.id} does not support text`)
    }
    if (model.testState !== 'success') {
      throw new ModelServiceError(
        'invalid-request',
        `Model ${model.id} has not passed text testing`
      )
    }
    if (connection.protocol !== 'openai-compatible') {
      throw new ModelServiceError('invalid-request', 'Agent 调用暂未接入')
    }
    requireVisionCapability(model, request.messages)
    return { connection, model }
  }
}

function requireVisionCapability(
  model: ModelOptionDto,
  messages: ModelCompletionRequest['messages']
): void {
  const hasImage = messages.some(
    (message) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.kind === 'image')
  )
  if (hasImage && !model.imageInputEnabled)
    throw new ModelServiceError(
      'invalid-request',
      `Model ${model.id} is not enabled for image input`
    )
}

function toDto(connection: StoredModelConnection): ModelConnectionDto {
  return {
    id: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    apiKeyHint: connection.apiKeyHint,
    expanded: connection.expanded,
    models: connection.models.map((model) => ({ ...model }))
  }
}

function requireConnection(
  connections: readonly StoredModelConnection[],
  connectionId: string
): StoredModelConnection {
  const connection = connections.find((candidate) => candidate.id === connectionId)
  if (!connection) {
    throw new ModelServiceError('invalid-request', `Unknown model connection: ${connectionId}`)
  }
  return connection
}

function mergeDiscoveredModel(connection: StoredModelConnection, id: string): ModelOptionDto {
  const existing = connection.models.find((model) => model.id === id)
  return existing ? { ...existing } : { id, name: id, enabled: true, testState: 'untested' }
}

export function validateDraft(draft: ModelConnectionDraftDto): ModelConnectionDraftDto {
  const name = draft.name.trim()
  const baseUrl = draft.baseUrl.trim()
  const apiKey = draft.apiKey.trim()
  if (!name) throw new ModelServiceError('invalid-request', 'Model set name is required')
  if (!apiKey) throw new ModelServiceError('invalid-request', 'API key is required')
  if (!baseUrl) throw new ModelServiceError('invalid-request', 'Base URL is required')
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new ModelServiceError('invalid-request', `Base URL is invalid: ${baseUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ModelServiceError('invalid-request', `Base URL must use http or https: ${baseUrl}`)
  }
  return { name, protocol: draft.protocol, baseUrl, apiKey }
}

function nextConnectionId(connections: readonly StoredModelConnection[], name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'model-connection'
  let id = base
  let suffix = 2
  while (connections.some((connection) => connection.id === id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

function toServiceError(failure: ProviderFailure | unknown): ModelServiceError {
  if (failure instanceof ModelServiceError) return failure
  if (failure instanceof ModelStorageError) {
    return new ModelServiceError('storage-error', failure.message)
  }
  if (failure instanceof SecretCipherUnavailableError) {
    return new ModelServiceError('secret-unavailable', failure.message)
  }
  if (isProviderFailure(failure)) {
    return new ModelServiceError(failure.code, failure.message)
  }
  return new ModelServiceError(
    'unknown',
    failure instanceof Error ? failure.message : String(failure)
  )
}

function isProviderFailure(value: unknown): value is ProviderFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}
