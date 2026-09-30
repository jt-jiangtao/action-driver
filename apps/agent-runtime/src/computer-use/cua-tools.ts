import type { ImageAssetRef } from '@action-driver/contracts'
import type {
  ToolDefinition,
  ToolExecutor,
  ToolExecutorEvent,
  ToolExecutionContext
} from '@action-driver/runtime-contracts'
import { catalog } from '@action-driver/computer-use-plugin/catalog'
import { createCuaRuntime } from './cua-runtime'
import { COMPUTER_USE_GUIDANCE_ERRORS } from '../tool-error-exposure'

type Registered = { definition: ToolDefinition; executor: ToolExecutor }
type Options = Parameters<typeof createCuaRuntime>[0] & {
  skillLoaded(sessionId: string): boolean
  /** The runtime must supply a volatile image port when registering these tools. */
  saveImage(sessionId: string, bytes: Buffer, mimeType: string): Promise<ImageAssetRef>
}

/** Tool adapter for the original computer-only CUA entry; host lifecycle is kept off the model API. */
export async function createCuaEntryTools(options: Options) {
  const runtime = createCuaRuntime(options)
  const requireContext = (context?: ToolExecutionContext) => {
    if (!context?.taskId || !context.sessionId || !context.workspace)
      throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.contextRequired)
    return { taskId: context.taskId, sessionId: context.sessionId, workspace: context.workspace }
  }
  const tools: Registered[] = [
    {
      definition: catalog.tools[0]!,
      executor: {
        async *execute(call, signal, context): AsyncIterable<ToolExecutorEvent> {
          const execution = requireContext(context)
          if (!options.skillLoaded(execution.sessionId))
            throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded)
          const input = call.arguments
          const code = input.code
          const timeout = input.timeout_ms
          if (
            Object.keys(input).some((key) => !['code', 'timeout_ms', 'title'].includes(key)) ||
            typeof code !== 'string' ||
            code.trim().length === 0 ||
            code.length > 200_000 ||
            (timeout !== undefined &&
              (typeof timeout !== 'number' ||
                !Number.isSafeInteger(timeout) ||
                timeout < 1_000 ||
                timeout > 300_000)) ||
            (input.title !== undefined &&
              (typeof input.title !== 'string' || input.title.length > 200))
          )
            throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.invalidInput)
          const cancel = new AbortController()
          const combined = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal
          const queue: ToolExecutorEvent[] = []
          let notify: (() => void) | undefined
          let finished = false
          let failure: unknown
          const images: Promise<void>[] = []
          const push = (event: ToolExecutorEvent) => {
            queue.push(event)
            notify?.()
            notify = undefined
          }
          const running = (async () => {
            try {
              const result = await runtime.run(
                execution,
                code,
                {
                  signal: combined,
                  ...(timeout === undefined ? {} : { timeoutMs: timeout as number })
                },
                {
                  text: (delta) => {
                    push({ kind: 'content', stream: 'result', delta })
                  },
                  image: (bytes, mimeType) => {
                    const index = images.length
                    const pending = options
                      .saveImage(execution.sessionId, bytes, mimeType)
                      .then((asset) => {
                        push({ kind: 'asset', index, asset })
                      })
                    // Attach rejection immediately; delivery is awaited before the result.
                    void pending.catch(() => {})
                    images.push(pending)
                  }
                }
              )
              await Promise.all(images)
              push({ kind: 'result', output: { output: result.output } })
            } catch (error) {
              failure = error
            } finally {
              await Promise.allSettled(images)
              finished = true
              notify?.()
              notify = undefined
            }
          })()
          try {
            while (!finished || queue.length) {
              if (!queue.length)
                await new Promise<void>((resolve) => {
                  notify = resolve
                })
              else yield queue.shift()!
            }
            await running
            if (failure) throw failure
          } finally {
            cancel.abort(new Error('CANCELLED: tool consumer ended'))
            await running
          }
        }
      }
    },
    {
      definition: catalog.tools[1]!,
      executor: {
        async *execute(call, _signal, context) {
          const execution = requireContext(context)
          if (Object.keys(call.arguments).length)
            throw new Error(COMPUTER_USE_GUIDANCE_ERRORS.invalidInput)
          await runtime.reset(execution.sessionId)
          yield { kind: 'result', output: { reset: true } }
        }
      }
    }
  ]
  return {
    tools,
    endTurn: runtime.endTurn,
    withSuspendedTimeout: runtime.withSuspendedTimeout,
    dispose: runtime.dispose
  }
}
