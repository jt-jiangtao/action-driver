import type { ImageAssetRef, ModelRef } from '@actiondriver/contracts'
import { createImageGenerationTool as createPluginTool } from '../../../../plugins/image-generation/src/execution'
export type ImageGenerationToolOptions = {
  defaultModel: () => Promise<ModelRef | null>
  generate: (
    request: { model: ModelRef; prompt: string },
    signal?: AbortSignal
  ) => Promise<Uint8Array>
  assets: { saveGenerated(sessionId: string, bytes: Uint8Array): Promise<ImageAssetRef> }
  sessionForTask: (taskId: string) => Promise<string | null>
}

export function createImageGenerationTool(options: ImageGenerationToolOptions) {
  return createPluginTool({ defaultModel: options.defaultModel, sessionForTask: options.sessionForTask, generateAsset: async ({ model, prompt, sessionId }, signal) => {
    const bytes = await options.generate({ model, prompt }, signal)
    if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
    return options.assets.saveGenerated(sessionId, bytes)
  } })
}
