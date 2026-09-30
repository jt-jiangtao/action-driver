import type {
  ImageGenerationApi,
  ModelConnectionDto,
  ModelOptionDto
} from '@action-driver/model-connections'
import { isTokenPlanBaseUrl } from '../media/token-plan-image-generation-adapter'
import {
  capabilityCandidates,
  isChatCandidate,
  isVerifiedTokenPlanImageModel
} from './model-capability-catalog'
import type { StoredModelConnection } from './store'

export function toDto(connection: StoredModelConnection): ModelConnectionDto {
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

export function mergeDiscoveredModel(
  connection: StoredModelConnection,
  id: string
): ModelOptionDto {
  const existing = connection.models.find((model) => model.id === id)
  return existing
    ? { ...existing }
    : { id, name: id, enabled: true, testState: 'untested', imageGenerationApi: 'openai-images' }
}

export function withCatalogLabels(model: ModelOptionDto, baseUrl: string): ModelOptionDto {
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

export function isImageEligible(model: ModelOptionDto, baseUrl: string): boolean {
  if (model.capabilities?.image_generation?.state !== 'success') return false
  if (!isVerifiedTokenPlanImageModel(model.id, baseUrl)) return true
  const selected = model.imageEndpointVerification?.selectedApi
  return Boolean(
    selected && model.imageEndpointVerification?.results[selected]?.state === 'success'
  )
}

export function selectedImageApi(model: ModelOptionDto, baseUrl: string): ImageGenerationApi {
  if (!isVerifiedTokenPlanImageModel(model.id, baseUrl)) return imageApiForModel(baseUrl)
  const results = model.imageEndpointVerification!.results
  return results['token-plan'].state === 'success' ? 'token-plan' : 'openai-images'
}

export function imageApiForModel(baseUrl: string): ImageGenerationApi {
  return isTokenPlanBaseUrl(baseUrl) ? 'token-plan' : 'openai-images'
}
