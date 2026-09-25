import type { HttpTransport } from './http-transport'
import type { ModelRef } from '@actiondriver/contracts'
import type { ImageResolver, OpenAiClientFactory, ProviderFailure } from './provider-adapters'
import { createModelProviderAdapter } from './provider-adapters'
import { createImageGenerationAdapter } from '../media/image-generation-adapter'
import { inspectImage } from '../media/session-asset-store'
import {
  createTokenPlanImageGenerationAdapter,
  isTokenPlanBaseUrl
} from '../media/token-plan-image-generation-adapter'
import type { SecretCipher } from './credential-cipher'
import { SecretCipherUnavailableError, apiKeyHint } from './credential-cipher'
import type { ModelConnectionStore, StoredModelConnection } from './store'
import { ModelStorageError } from './store'
import { ModelServiceError } from '@actiondriver/model-connections'
import { capabilityCandidates } from './model-capability-catalog'
import { probeCapability } from './capability-probes'
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
  ModelSetKindRequestDto,
  ModelImageCapabilityRequestDto,
  ModelImageGenerationApiRequestDto,
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
    const { connection, model } = this.requireRunnableModel(request)
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
    return result.value.map((id) => {
      const labels = capabilityCandidates(id, validated.baseUrl).displayOnly
      return { id, name: id, enabled: true, testState: 'untested' as const, ...(labels.length ? { catalogLabels: labels } : {}) }
    })
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
    const defaultImageModel = this.options.store.readDefaultImageModel()
    connection.models = [
      ...result.value.map((id) => mergeDiscoveredModel(connection, id)),
      ...connection.models.filter(
        (model) =>
          !discovered.has(model.id) &&
          (model.kind === 'image' ||
            model.imageInputEnabled === true ||
            model.imageGenerationEnabled === true ||
            (defaultImageModel?.connectionId === connection.id &&
              defaultImageModel.modelId === model.id))
      )
    ]
    this.write(connections)
    return connection.models.map((model) => withCatalogLabels(model, connection.baseUrl))
  }

  async testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]> {
    const validated = validateDraft(request.draft)
    if (request.capabilityTest) {
      return await this.probeModelCapabilities(
        {
          baseUrl: validated.baseUrl,
          apiKey: validated.apiKey,
          protocol: validated.protocol
        },
        request.modelIds
      )
    }
    return await this.probeModels(
      {
        baseUrl: validated.baseUrl,
        apiKey: validated.apiKey,
        protocol: validated.protocol
      },
      request.modelIds,
      request.imageModels ?? []
    )
  }

  async testConnectionModels(
    request: ModelConnectionTestRequestDto
  ): Promise<ModelTestResultDto[]> {
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    if (request.capabilityTest) {
      const results = await this.probeModelCapabilities(
        {
          baseUrl: connection.baseUrl,
          apiKey: this.decrypt(connection),
          protocol: connection.protocol
        },
        request.modelIds
      )
      const byId = new Map(results.map((result) => [result.modelId, result]))
      connection.models = connection.models.map((model) => {
        const result = byId.get(model.id)
        return result
          ? {
              ...model,
              testState: result.state,
              capabilities: { ...model.capabilities, ...result.capabilities }
            }
          : model
      })
      this.write(connections)
      return results
    }
    const results = await this.probeModels(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        protocol: connection.protocol
      },
      request.modelIds,
      request.modelIds.flatMap((modelId) => {
        const model = connection.models.find((candidate) => candidate.id === modelId)
        return model?.kind === 'image'
          ? [{ modelId, api: model.imageGenerationApi ?? 'openai-images' }]
          : []
      })
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

  async setModelKind(request: ModelSetKindRequestDto): Promise<void> {
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    if (request.kind === 'image' && connection.protocol !== 'openai-compatible')
      throw new ModelServiceError(
        'invalid-request',
        'Image generation requires an OpenAI compatible connection'
      )
    const model = connection.models.find((candidate) => candidate.id === request.modelId)
    if (!model) throw new ModelServiceError('invalid-request', `Unknown model: ${request.modelId}`)
    connection.models = connection.models.map((candidate) =>
      candidate.id === request.modelId
        ? {
            ...candidate,
            kind: request.kind,
            imageGenerationEnabled: request.kind === 'image',
            testState: 'untested'
          }
        : candidate
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
      candidate.id === request.modelId
        ? {
            ...candidate,
            [field]: request.enabled,
            ...(request.kind === 'generation' ? { kind: request.enabled ? 'image' : 'chat' } : {})
          }
        : candidate
    )
    this.write(connections)
  }

  async setModelImageGenerationApi(request: ModelImageGenerationApiRequestDto): Promise<void> {
    if (request.api !== 'openai-images' && request.api !== 'token-plan')
      throw new ModelServiceError('invalid-request', 'Invalid image generation API')
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    const model = connection.models.find((candidate) => candidate.id === request.modelId)
    if (!model) throw new ModelServiceError('invalid-request', `Unknown model: ${request.modelId}`)
    if (model.kind !== 'image')
      throw new ModelServiceError('invalid-request', 'Image generation API requires an image model')
    if (request.api === 'token-plan' && !isTokenPlanBaseUrl(connection.baseUrl))
      throw new ModelServiceError(
        'invalid-request',
        'Token Plan requires an official HTTPS gateway'
      )
    connection.models = connection.models.map((candidate) =>
      candidate.id === request.modelId
        ? { ...candidate, imageGenerationApi: request.api, testState: 'untested' }
        : candidate
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
        !isImageEligible(chosen)
      )
        throw new ModelServiceError('invalid-request', 'Image model is unavailable')
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
    if (connection.protocol !== 'openai-compatible' || !model?.enabled || !isImageEligible(model))
      throw new ModelServiceError('invalid-request', 'Image model is unavailable')
    const adapter =
      imageApiForModel(connection.baseUrl, model) === 'token-plan'
        ? createTokenPlanImageGenerationAdapter()
        : createImageGenerationAdapter()
    const bytes = await adapter.generate(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        modelId: model.id,
        prompt: request.prompt
      },
      signal
    )
    const currentDefault = await this.getDefaultImageModel()
    if (
      !currentDefault ||
      currentDefault.connectionId !== selected.connectionId ||
      currentDefault.modelId !== selected.modelId
    )
      throw new ModelServiceError('invalid-request', 'Default image model changed')
    const currentConnection = this.read().find(
      (candidate) => candidate.id === selected.connectionId
    )
    const currentModel = currentConnection?.models.find(
      (candidate) => candidate.id === selected.modelId
    )
    if (!currentModel?.enabled || !isImageEligible(currentModel))
      throw new ModelServiceError('invalid-request', 'Image model is unavailable')
    if (
      imageApiForModel(currentConnection!.baseUrl, currentModel) !==
      imageApiForModel(connection.baseUrl, model)
    )
      throw new ModelServiceError('invalid-request', 'Image generation API changed')
    return bytes
  }

  async add(request: ModelAddRequestDto): Promise<ModelConnectionDto> {
    const draft = validateDraft(request.draft)
    for (const model of request.models) {
      if (model.kind === 'image' && draft.protocol !== 'openai-compatible')
        throw new ModelServiceError(
          'invalid-request',
          'Image generation requires an OpenAI compatible connection'
        )
      const api = model.imageGenerationApi ?? 'openai-images'
      if (api !== 'openai-images' && api !== 'token-plan')
        throw new ModelServiceError('invalid-request', 'Invalid image generation API')
      if (api === 'token-plan' && !isTokenPlanBaseUrl(draft.baseUrl))
        throw new ModelServiceError(
          'invalid-request',
          'Token Plan requires an official HTTPS gateway'
        )
    }
    const connections = this.read()
    const connection: StoredModelConnection = {
      id: nextConnectionId(connections, draft.name),
      name: draft.name,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      apiKeyCipher: this.encrypt(draft.apiKey),
      apiKeyHint: apiKeyHint(draft.apiKey),
      expanded: true,
      models: request.models.map((model) => ({
        ...model,
        kind: model.kind ?? (model.imageGenerationEnabled ? 'image' : 'chat'),
        imageGenerationApi: model.imageGenerationApi ?? 'openai-images'
      }))
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
    modelIds: readonly string[],
    imageModels: readonly { modelId: string; api: 'openai-images' | 'token-plan' }[]
  ): Promise<ModelTestResultDto[]> {
    const adapter = createModelProviderAdapter(endpoint.protocol, this.options.transport)
    const imageApiById = new Map(imageModels.map((model) => [model.modelId, model.api]))
    const results: ModelTestResultDto[] = []
    for (const modelId of modelIds) {
      const imageApi = imageApiById.get(modelId)
      if (!imageApi) {
        const result = await adapter.probeModel({ ...endpoint, modelId })
        results.push({ modelId, state: result.state })
        continue
      }
      if (endpoint.protocol !== 'openai-compatible') {
        results.push({ modelId, state: 'unsupported' })
        continue
      }
      try {
        const imageAdapter =
          imageApi === 'token-plan'
            ? createTokenPlanImageGenerationAdapter()
            : createImageGenerationAdapter()
        const bytes = await imageAdapter.generate({
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          modelId,
          prompt: 'A simple blue square on a white background'
        })
        await inspectImage(bytes)
        results.push({ modelId, state: 'success' })
      } catch {
        results.push({ modelId, state: 'failed' })
      }
    }
    return results
  }

  private async probeModelCapabilities(
    endpoint: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
    modelIds: readonly string[]
  ): Promise<ModelTestResultDto[]> {
    const results: ModelTestResultDto[] = []
    for (const modelId of modelIds) {
      const candidates = capabilityCandidates(modelId, endpoint.baseUrl)
      const capabilities: NonNullable<ModelTestResultDto['capabilities']> = {}
      for (const capability of candidates.probes) {
        capabilities[capability] = await probeCapability({
          endpoint,
          modelId,
          capability,
          transport: this.options.transport
        })
      }
      const states = Object.values(capabilities).map((result) => result.state)
      const state = states.includes('success')
        ? 'success'
        : states.includes('failed') || states.includes('inconclusive')
          ? 'failed'
          : 'unsupported'
      results.push({ modelId, state, capabilities })
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
    if (model.kind === 'image') {
      throw new ModelServiceError('invalid-request', `Model ${model.id} is for image generation`)
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
    return { connection, model }
  }
}

function toDto(connection: StoredModelConnection): ModelConnectionDto {
  return {
    id: connection.id,
    name: connection.name,
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    apiKeyHint: connection.apiKeyHint,
    expanded: connection.expanded,
    models: connection.models.map((model) => withCatalogLabels(model, connection.baseUrl))
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
  return existing
    ? { ...existing }
    : { id, name: id, enabled: true, testState: 'untested', imageGenerationApi: 'openai-images' }
}

function withCatalogLabels(model: ModelOptionDto, baseUrl: string): ModelOptionDto {
  const labels = capabilityCandidates(model.id, baseUrl).displayOnly
  return { ...model, ...(labels.length ? { catalogLabels: labels } : {}) }
}

function isImageEligible(model: ModelOptionDto): boolean {
  const tested = model.capabilities?.image_generation
  return tested ? tested.state === 'success' : model.kind === 'image'
}

function imageApiForModel(
  baseUrl: string,
  model: ModelOptionDto
): 'token-plan' | 'openai-images' {
  return model.capabilities?.image_generation?.state === 'success'
    ? isTokenPlanBaseUrl(baseUrl)
      ? 'token-plan'
      : 'openai-images'
    : (model.imageGenerationApi ?? 'openai-images')
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
