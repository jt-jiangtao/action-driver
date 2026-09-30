import type { HttpTransport } from '@action-driver/model-provider-runtime/http-transport'
import { createHash } from 'node:crypto'
import type { ModelRef } from '@action-driver/contracts'
import type {
  ImageResolver,
  OpenAiClientFactory
} from '@action-driver/model-provider-runtime/provider-adapters'
import { createModelProviderAdapter } from '@action-driver/model-provider-runtime/provider-adapters'
import { createImageGenerationAdapter } from '../media/image-generation-adapter'
import { createTokenPlanImageGenerationAdapter } from '../media/token-plan-image-generation-adapter'
import type { SecretCipher } from './credential-cipher'
import { apiKeyHint } from './credential-cipher'
import type { ModelConnectionStore, StoredModelConnection } from './store'
import { ModelServiceError } from '@action-driver/model-connections'
import {
  capabilityCandidates,
  isChatCandidate,
  isVerifiedTokenPlanImageModel
} from './model-capability-catalog'
import { probeModelCapabilities } from './model-capability-testing'
import { toServiceError } from './model-service-error'
import {
  imageApiForModel,
  isImageEligible,
  mergeDiscoveredModel,
  selectedImageApi,
  toDto,
  withCatalogLabels
} from './model-option-policy'
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
  ModelTestRequestDto,
  ModelTestResultDto,
  ImageEndpointVerification,
  ModelConnectionServicePort,
  ModelCompletionServicePort
} from '@action-driver/model-connections'

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
  private readonly draftImageVerifications = new Map<string, ImageEndpointVerification>()

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
      const { probes, displayOnly: labels } = capabilityCandidates(id, validated.baseUrl)
      return {
        id,
        name: id,
        enabled: true,
        testState: 'untested' as const,
        probeCandidates: probes,
        chatCandidate: isChatCandidate(id, validated.baseUrl),
        ...(labels.length ? { catalogLabels: labels } : {})
      }
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
    const currentConnections = this.read()
    const currentConnection = requireConnection(currentConnections, connectionId)
    currentConnection.models = [
      ...result.value.map((id) => mergeDiscoveredModel(currentConnection, id)),
      ...currentConnection.models.filter((model) => !discovered.has(model.id))
    ]
    this.write(currentConnections)
    return currentConnection.models.map((model) =>
      withCatalogLabels(model, currentConnection.baseUrl)
    )
  }

  async testModels(request: ModelTestRequestDto): Promise<ModelTestResultDto[]> {
    const validated = validateDraft(request.draft)
    const results = await probeModelCapabilities(
      { baseUrl: validated.baseUrl, apiKey: validated.apiKey, protocol: validated.protocol },
      request.modelIds,
      this.options.transport
    )
    for (const result of results) {
      if (result.imageEndpointVerification) {
        this.draftImageVerifications.set(
          draftImageVerificationKey(validated, result.modelId),
          result.imageEndpointVerification
        )
      }
    }
    return results
  }

  async testConnectionModels(
    request: ModelConnectionTestRequestDto
  ): Promise<ModelTestResultDto[]> {
    const connections = this.read()
    const connection = requireConnection(connections, request.connectionId)
    const results = await probeModelCapabilities(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        protocol: connection.protocol
      },
      request.modelIds,
      this.options.transport
    )
    const byId = new Map(results.map((result) => [result.modelId, result]))
    const currentConnections = this.read()
    const currentConnection = requireConnection(currentConnections, request.connectionId)
    if (
      currentConnection.protocol !== connection.protocol ||
      currentConnection.baseUrl !== connection.baseUrl ||
      currentConnection.apiKeyCipher !== connection.apiKeyCipher
    )
      throw new ModelServiceError('invalid-request', 'Model connection changed during testing')
    currentConnection.models = currentConnection.models.map((model) => {
      const result = byId.get(model.id)
      return result
        ? {
            ...model,
            testState: result.state,
            capabilities: result.capabilities ?? {},
            imageEndpointVerification: result.imageEndpointVerification,
            ...(result.imageEndpointVerification
              ? {
                  imageGenerationApi:
                    result.imageEndpointVerification.selectedApi ?? 'openai-images'
                }
              : {})
          }
        : model
    })
    this.write(currentConnections)
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

  async setDefaultImageModel(model: ModelRef | null): Promise<void> {
    if (model) {
      const connection = requireConnection(this.read(), model.connectionId)
      const chosen = connection.models.find((candidate) => candidate.id === model.modelId)
      if (
        connection.protocol !== 'openai-compatible' ||
        !chosen?.enabled ||
        !isImageEligible(chosen, connection.baseUrl)
      )
        throw new ModelServiceError('invalid-request', 'Image model is unavailable')
    }
    this.options.store.writeDefaultImageModel(model)
  }

  async getDefaultImageModel(): Promise<ModelRef | null> {
    const selected = this.options.store.readDefaultImageModel()
    if (!selected) return null
    const connection = this.read().find((candidate) => candidate.id === selected.connectionId)
    const model = connection?.models.find((candidate) => candidate.id === selected.modelId)
    return connection?.protocol === 'openai-compatible' &&
      model?.enabled &&
      isImageEligible(model, connection.baseUrl)
      ? selected
      : null
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
      !isImageEligible(model, connection.baseUrl)
    )
      throw new ModelServiceError('invalid-request', 'Image model is unavailable')
    const adapter =
      selectedImageApi(model, connection.baseUrl) === 'token-plan'
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
    if (!currentModel?.enabled || !isImageEligible(currentModel, currentConnection!.baseUrl))
      throw new ModelServiceError('invalid-request', 'Image model is unavailable')
    if (
      currentConnection!.baseUrl !== connection.baseUrl ||
      currentConnection!.apiKeyCipher !== connection.apiKeyCipher
    )
      throw new ModelServiceError('invalid-request', 'Image model connection changed')
    if (
      selectedImageApi(currentModel, currentConnection!.baseUrl) !==
      selectedImageApi(model, connection.baseUrl)
    )
      throw new ModelServiceError('invalid-request', 'Image generation API changed')
    return bytes
  }

  async add(request: ModelAddRequestDto): Promise<ModelConnectionDto> {
    const draft = validateDraft(request.draft)
    for (const model of request.models) {
      if (
        model.capabilities?.image_generation?.state === 'success' &&
        draft.protocol !== 'openai-compatible'
      )
        throw new ModelServiceError(
          'invalid-request',
          'Image generation requires an OpenAI compatible connection'
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
      models: request.models.map((model) => {
        const verification = isVerifiedTokenPlanImageModel(model.id, draft.baseUrl)
          ? this.draftImageVerifications.get(draftImageVerificationKey(draft, model.id))
          : undefined
        return {
          ...model,
          imageEndpointVerification: verification,
          kind:
            model.kind ??
            (model.capabilities?.text?.state === 'success'
              ? 'chat'
              : model.capabilities?.image_generation?.state === 'success'
                ? 'image'
                : 'chat'),
          imageGenerationApi: verification?.selectedApi ?? imageApiForModel(draft.baseUrl)
        }
      })
    }
    this.write([...connections, connection])
    for (const model of request.models) {
      if (isVerifiedTokenPlanImageModel(model.id, draft.baseUrl)) {
        this.draftImageVerifications.delete(draftImageVerificationKey(draft, model.id))
      }
    }
    return toDto(connection)
  }

  async delete(connectionId: string): Promise<void> {
    const connections = this.read()
    requireConnection(connections, connectionId)
    this.write(connections.filter((connection) => connection.id !== connectionId))
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
    if (!isChatCandidate(model.id, connection.baseUrl)) {
      throw new ModelServiceError('invalid-request', `Model ${model.id} does not support chat`)
    }
    if (connection.protocol !== 'openai-compatible') {
      throw new ModelServiceError('invalid-request', 'Agent 调用暂未接入')
    }
    return { connection, model }
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

function draftImageVerificationKey(
  draft: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
  modelId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([draft.protocol, draft.baseUrl, draft.apiKey, modelId]))
    .digest('hex')
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
