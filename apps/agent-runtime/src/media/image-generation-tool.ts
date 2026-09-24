import type { ImageAssetRef, ModelRef } from '@actiondriver/contracts'
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolExecutorEvent
} from '@actiondriver/runtime-contracts'

export type ImageGenerationToolOptions = {
  defaultModel: () => Promise<ModelRef | null>
  generate: (
    request: { model: ModelRef; prompt: string },
    signal?: AbortSignal
  ) => Promise<Uint8Array>
  assets: { saveGenerated(sessionId: string, bytes: Uint8Array): Promise<ImageAssetRef> }
  sessionForTask: (taskId: string) => Promise<string | null>
}

const definition: ToolDefinition = {
  id: 'image.generate',
  version: 1,
  modelName: 'image_generate',
  description:
    'Generate one to four images from independent text prompts. Each image may complete separately.',
  inputSchema: {
    type: 'object',
    properties: {
      images: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 } },
          required: ['prompt'],
          additionalProperties: false
        }
      }
    },
    required: ['images'],
    additionalProperties: false
  },
  risk: 'medium',
  sideEffects: { filesystem: 'write', network: true },
  timeoutMs: 180_000
}

type Settled = { index: number; ok: true; bytes: Uint8Array } | { index: number; ok: false }

export function createImageGenerationTool(options: ImageGenerationToolOptions): {
  definition: ToolDefinition
  executor: ToolExecutor
} {
  return {
    definition,
    executor: {
      async *execute(call: ToolCall, signal?: AbortSignal): AsyncIterable<ToolExecutorEvent> {
        const images = call.arguments.images
        if (
          !Array.isArray(images) ||
          images.length < 1 ||
          images.length > 4 ||
          images.some((item) => !isPrompt(item))
        )
          throw new Error('IMAGE_COUNT_INVALID')
        const match = /^tool:(.+):\d+:\d+$/.exec(call.callId)
        if (!match) throw new Error('IMAGE_TASK_INVALID')
        const sessionId = await options.sessionForTask(match[1]!)
        if (!sessionId) throw new Error('IMAGE_SESSION_NOT_FOUND')
        const model = await options.defaultModel()
        if (!model) throw new Error('IMAGE_MODEL_NOT_CONFIGURED')
        if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')

        const pending = new Map<number, Promise<Settled>>()
        for (const [index, item] of images.entries()) {
          const prompt = (item as { prompt: string }).prompt.trim()
          pending.set(
            index,
            options
              .generate({ model, prompt }, signal)
              .then((bytes): Settled => ({ index, ok: true, bytes }))
              .catch((): Settled => ({ index, ok: false }))
          )
        }
        let succeeded = 0
        let failed = 0
        while (pending.size) {
          if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
          const settled = await Promise.race(pending.values())
          pending.delete(settled.index)
          if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
          if (!settled.ok) {
            failed += 1
            continue
          }
          try {
            const asset = await options.assets.saveGenerated(sessionId, settled.bytes)
            if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
            succeeded += 1
            yield { kind: 'asset', index: settled.index, asset }
          } catch (error) {
            if (signal?.aborted) throw signal.reason ?? error
            failed += 1
          }
        }
        if (!succeeded) throw new Error('IMAGE_GENERATION_FAILED')
        yield { kind: 'result', output: { succeeded, failed } }
      }
    }
  }
}

function isPrompt(value: unknown): value is { prompt: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { prompt?: unknown }).prompt === 'string' &&
    (value as { prompt: string }).prompt.trim().length > 0 &&
    (value as { prompt: string }).prompt.length <= 4000
  )
}
