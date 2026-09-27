import type { ImageAssetRef } from '@actiondriver/plugin-sdk'
import { definition } from './catalog.js'
export type ModelRef = { connectionId: string; modelId: string }
import type {
  ToolCall,
  ToolExecutor,
  ToolExecutorEvent
} from '@actiondriver/plugin-sdk'

export type ImageGenerationToolOptions = {
  defaultModel: () => Promise<ModelRef | null>
  generateAsset: (
    request: { model: ModelRef; prompt: string; sessionId: string },
    signal?: AbortSignal
  ) => Promise<ImageAssetRef>
  sessionForTask: (taskId: string) => Promise<string | null>
}


type Settled = { index: number; ok: true; asset: ImageAssetRef } | { index: number; ok: false }

export function createImageGenerationTool(options: ImageGenerationToolOptions): {
  definition: typeof definition
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
          images.length > 16 ||
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
        let nextIndex = 0
        const startNext = () => {
          if (signal?.aborted || nextIndex >= images.length) return
          const index = nextIndex++
          const prompt = (images[index] as { prompt: string }).prompt.trim()
          pending.set(
            index,
            Promise.resolve()
              .then(() => options.generateAsset({ model, prompt, sessionId }, signal))
              .then((asset): Settled => ({ index, ok: true, asset }))
              .catch((): Settled => ({ index, ok: false }))
          )
        }
        for (let index = 0; index < Math.min(4, images.length); index += 1) startNext()
        let succeeded = 0
        let failed = 0
        while (pending.size) {
          if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
          const settled = await waitForSettledOrAbort(pending.values(), signal)
          pending.delete(settled.index)
          if (signal?.aborted) throw signal.reason ?? new Error('IMAGE_CANCELLED')
          startNext()
          if (!settled.ok) {
            failed += 1
            continue
          }
          try {
            const asset = settled.asset
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

function waitForSettledOrAbort<T>(
  promises: Iterable<Promise<T>>,
  signal?: AbortSignal
): Promise<T> {
  const next = Promise.race(promises)
  if (!signal) return next
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('IMAGE_CANCELLED'))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new Error('IMAGE_CANCELLED'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    next.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
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
