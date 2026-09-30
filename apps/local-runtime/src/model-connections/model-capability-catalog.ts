import type { ModelCapability } from '@action-driver/model-connections'
import { isTokenPlanBaseUrl } from '../media/token-plan-image-generation-adapter'

export type DisplayOnlyCapability =
  | 'speech_recognition'
  | 'realtime_chat'
  | 'speech_synthesis'
  | 'text_to_video'
  | 'image_to_video'
  | 'reference_to_video'

const TEXT_REASONING_VISION: readonly ModelCapability[] = ['text', 'reasoning', 'vision']
const TEXT_REASONING: readonly ModelCapability[] = ['text', 'reasoning']
const IMAGE: readonly ModelCapability[] = ['image_generation']
const ALL_PROBES: readonly ModelCapability[] = ['text', 'reasoning', 'vision', 'image_generation']
const VERIFIED_TOKEN_PLAN_IMAGE_MODELS = new Set([
  'wan2.7-image',
  'wan2.7-image-pro',
  'qwen-image-3.0-pro'
])

export function isVerifiedTokenPlanImageModel(modelId: string, baseUrl: string): boolean {
  return isTokenPlanBaseUrl(baseUrl) && VERIFIED_TOKEN_PLAN_IMAGE_MODELS.has(modelId)
}

const TOKEN_PLAN_CATALOG: Readonly<
  Record<
    string,
    { probes: readonly ModelCapability[]; displayOnly: readonly DisplayOnlyCapability[] }
  >
> = {
  'qwen3.8-max': { probes: TEXT_REASONING_VISION, displayOnly: [] },
  'qwen3.8-flash': { probes: TEXT_REASONING_VISION, displayOnly: [] },
  'qwen3.7-plus': { probes: TEXT_REASONING_VISION, displayOnly: [] },
  'qwen3.6-flash': { probes: TEXT_REASONING_VISION, displayOnly: [] },
  'qwen3.7-max': { probes: TEXT_REASONING, displayOnly: [] },
  'deepseek-v4.1-flash': { probes: TEXT_REASONING, displayOnly: [] },
  'deepseek-v4-pro-0813': { probes: TEXT_REASONING, displayOnly: [] },
  'deepseek-v4-pro': { probes: TEXT_REASONING, displayOnly: [] },
  'deepseek-v4-flash-0731': { probes: TEXT_REASONING, displayOnly: [] },
  'glm-5.3': { probes: TEXT_REASONING, displayOnly: [] },
  'glm-5.2': { probes: TEXT_REASONING, displayOnly: [] },
  'qwen-image-3.0-pro': { probes: IMAGE, displayOnly: [] },
  'wan2.7-image': { probes: IMAGE, displayOnly: [] },
  'wan2.7-image-pro': { probes: IMAGE, displayOnly: [] },
  'qwen-audio-3.0-asr-flash': { probes: [], displayOnly: ['speech_recognition'] },
  'qwen-audio-3.0-realtime-plus': { probes: [], displayOnly: ['realtime_chat'] },
  'qwen-audio-3.0-tts-plus': { probes: [], displayOnly: ['speech_synthesis'] },
  'happyhorse-1.1-t2v': { probes: [], displayOnly: ['text_to_video'] },
  'happyhorse-1.1-i2v': { probes: [], displayOnly: ['image_to_video'] },
  'happyhorse-1.1-r2v': { probes: [], displayOnly: ['reference_to_video'] }
}

export function capabilityCandidates(
  modelId: string,
  baseUrl: string
): { probes: ModelCapability[]; displayOnly: DisplayOnlyCapability[] } {
  const known = isTokenPlanBaseUrl(baseUrl) ? TOKEN_PLAN_CATALOG[modelId] : undefined
  return {
    probes: [...ALL_PROBES],
    displayOnly: [...(known?.displayOnly ?? [])]
  }
}

export function isChatCandidate(modelId: string, baseUrl: string): boolean {
  const known = isTokenPlanBaseUrl(baseUrl) ? TOKEN_PLAN_CATALOG[modelId] : undefined
  return known ? known.probes.includes('text') : true
}
