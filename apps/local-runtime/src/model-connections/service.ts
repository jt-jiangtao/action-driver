import type { HttpTransport } from '@action-driver/model-provider-runtime/http-transport'
import { createHash } from 'node:crypto'
import type { ModelRef } from '@action-driver/contracts'
import type {
  ImageResolver,
  OpenAiClientFactory,
  ProviderFailure
} from '@action-driver/model-provider-runtime/provider-adapters'
import { createModelProviderAdapter } from '@action-driver/model-provider-runtime/provider-adapters'
import { createImageGenerationAdapter } from '../media/image-generation-adapter'
import {
  createTokenPlanImageGenerationAdapter,
  isTokenPlanBaseUrl
} from '../media/token-plan-image-generation-adapter'
import type { SecretCipher } from './credential-cipher'
import { SecretCipherUnavailableError, apiKeyHint } from './credential-cipher'
import type { ModelConnectionStore, StoredModelConnection } from './store'
import { ModelStorageError } from './store'
import { ModelServiceError } from '@action-driver/model-connections'
import {
  capabilityCandidates,
  isChatCandidate,
  isVerifiedTokenPlanImageModel
} from './model-capability-catalog'
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
  ModelTestRequestDto,
  ModelTestResultDto,
  ImageEndpointVerification,
  ImageGenerationApi,
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
    const results = await this.probeModelCapabilities(
      { baseUrl: validated.baseUrl, apiKey: validated.apiKey, protocol: validated.protocol },
      request.modelIds
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
    const results = await this.probeModelCapabilities(
      {
        baseUrl: connection.baseUrl,
        apiKey: this.decrypt(connection),
        protocol: connection.protocol
      },
      request.modelIds
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

  private async probeModelCapabilities(
    endpoint: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
    modelIds: readonly string[]
  ): Promise<ModelTestResultDto[]> {
    const results: ModelTestResultDto[] = new Array(modelIds.length)
    let nextIndex = 0
    const testOne = async (modelId: string): Promise<ModelTestResultDto> => {
      const candidates = capabilityCandidates(modelId, endpoint.baseUrl)
      const capabilities: NonNullable<ModelTestResultDto['capabilities']> = {}
      let imageEndpointVerification: ImageEndpointVerification | undefined
      await Promise.all(
        candidates.probes.map(async (capability) => {
          try {
            if (
              capability === 'image_generation' &&
              isVerifiedTokenPlanImageModel(modelId, endpoint.baseUrl)
            ) {
              const tested = await probeTokenPlanImageEndpoints(
                endpoint,
                modelId,
                this.options.transport
              )
              capabilities.image_generation = tested.capability
              imageEndpointVerification = tested.verification
            } else {
              capabilities[capability] = await probeCapability({
                endpoint,
                modelId,
                capability,
                transport: this.options.transport
              })
            }
          } catch (error) {
            const failure = toServiceError(error)
            capabilities[capability] = {
              state: 'failed',
              source: 'probe',
              testedAt: new Date().toISOString(),
              failure: { code: failure.code, message: failure.message }
            }
          }
        })
      )
      const states = Object.values(capabilities).map((result) => result.state)
      const state = states.includes('success')
        ? 'success'
        : states.includes('failed') || states.includes('inconclusive')
          ? 'failed'
          : 'unsupported'
      return {
        modelId,
        state,
        capabilities,
        ...(imageEndpointVerification ? { imageEndpointVerification } : {})
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(4, modelIds.length) }, async () => {
        while (nextIndex < modelIds.length) {
          const index = nextIndex++
          results[index] = await testOne(modelIds[index]!)
        }
      })
    )
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
    if (!isChatCandidate(model.id, connection.baseUrl)) {
      throw new ModelServiceError('invalid-request', `Model ${model.id} does not support chat`)
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
  const { probes, displayOnly: labels } = capabilityCandidates(model.id, baseUrl)
  const needsImageVerification =
    isVerifiedTokenPlanImageModel(model.id, baseUrl) &&
    model.capabilities?.image_generation?.state === 'success' &&
    !isImageEligible(model, baseUrl)
  return {
    ...model,
    ...(needsImageVerification
      ? {
          capabilities: {
            ...model.capabilities,
            image_generation: { state: 'untested' as const, source: 'legacy' as const }
          }
        }
      : {}),
    probeCandidates: probes,
    chatCandidate: isChatCandidate(model.id, baseUrl),
    ...(labels.length ? { catalogLabels: labels } : {})
  }
}

function isImageEligible(model: ModelOptionDto, baseUrl: string): boolean {
  if (model.capabilities?.image_generation?.state !== 'success') return false
  if (!isVerifiedTokenPlanImageModel(model.id, baseUrl)) return true
  const selected = model.imageEndpointVerification?.selectedApi
  return Boolean(
    selected && model.imageEndpointVerification?.results[selected]?.state === 'success'
  )
}

function selectedImageApi(model: ModelOptionDto, baseUrl: string): ImageGenerationApi {
  if (!isVerifiedTokenPlanImageModel(model.id, baseUrl)) return imageApiForModel(baseUrl)
  const results = model.imageEndpointVerification!.results
  return results['token-plan'].state === 'success' ? 'token-plan' : 'openai-images'
}

function imageApiForModel(baseUrl: string): 'token-plan' | 'openai-images' {
  return isTokenPlanBaseUrl(baseUrl) ? 'token-plan' : 'openai-images'
}

function draftImageVerificationKey(
  draft: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
  modelId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([draft.protocol, draft.baseUrl, draft.apiKey, modelId]))
    .digest('hex')
}

async function probeTokenPlanImageEndpoints(
  endpoint: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
  modelId: string,
  transport: HttpTransport
): Promise<{
  capability: NonNullable<NonNullable<ModelTestResultDto['capabilities']>['image_generation']>
  verification: ImageEndpointVerification
}> {
  const results = {} as ImageEndpointVerification['results']
  for (const api of ['openai-images', 'token-plan'] as const) {
    const adapter =
      api === 'token-plan'
        ? createTokenPlanImageGenerationAdapter()
        : createImageGenerationAdapter()
    const outcome = await probeCapability({
      endpoint,
      modelId,
      capability: 'image_generation',
      transport,
      imageGenerator: (signal) =>
        adapter.generate(
          {
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            modelId,
            prompt: 'A simple blue square on a white background'
          },
          signal
        )
    })
    results[api] = {
      state: outcome.state === 'success' ? 'success' : 'failed',
      testedAt: outcome.testedAt ?? new Date().toISOString(),
      ...(outcome.failure ? { failure: outcome.failure } : {})
    }
  }
  const selectedApi: ImageGenerationApi | null =
    results['token-plan'].state === 'success'
      ? 'token-plan'
      : results['openai-images'].state === 'success'
        ? 'openai-images'
        : null
  return {
    capability: {
      state: selectedApi ? 'success' : 'failed',
      source: 'probe',
      testedAt: results['token-plan'].testedAt,
      ...(!selectedApi && results['token-plan'].failure
        ? { failure: results['token-plan'].failure }
        : {})
    },
    verification: { selectedApi, results }
  }
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
