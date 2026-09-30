import type { HttpTransport } from '@action-driver/model-provider-runtime/http-transport'
import type {
  ImageEndpointVerification,
  ImageGenerationApi,
  ModelTestResultDto
} from '@action-driver/model-connections'
import { createImageGenerationAdapter } from '../media/image-generation-adapter'
import { createTokenPlanImageGenerationAdapter } from '../media/token-plan-image-generation-adapter'
import { capabilityCandidates, isVerifiedTokenPlanImageModel } from './model-capability-catalog'
import { probeCapability } from './capability-probes'
import { toServiceError } from './model-service-error'
import type { StoredModelConnection } from './store'

export async function probeModelCapabilities(
  endpoint: { baseUrl: string; apiKey: string; protocol: StoredModelConnection['protocol'] },
  modelIds: readonly string[],
  transport: HttpTransport
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
            const tested = await probeTokenPlanImageEndpoints(endpoint, modelId, transport)
            capabilities.image_generation = tested.capability
            imageEndpointVerification = tested.verification
          } else {
            capabilities[capability] = await probeCapability({
              endpoint,
              modelId,
              capability,
              transport: transport
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
