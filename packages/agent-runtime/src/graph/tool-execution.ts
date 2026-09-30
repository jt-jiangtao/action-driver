import type { ImageAssetRef } from '@action-driver/contracts'
import {
  parseToolCall,
  type ToolDefinition,
  type ToolEvent
} from '@action-driver/runtime-contracts'
import type { RuntimeToolRegistry } from '../tool-registry'
import type { RuntimeToolPolicy } from '../tool-policy'
import type { ToolInvocationService } from '../tool-invocation-service'
import type { ModelEventObserver, RuntimeMessage, ToolEventObserver } from '../ports'
import {
  redactCollectedOutput,
  redactToolError,
  type ToolRedaction
} from '../tool-result-redaction'
import {
  activityTitleForTools,
  defaultActivityId,
  isVolatileComputerImage,
  nextActivityId
} from './helpers'
import type { AgentState } from './state'

export type GraphToolRuntime = {
  registry: RuntimeToolRegistry
  policy: RuntimeToolPolicy
  invocations: ToolInvocationService
  grants: string[]
  isAvailable?: (definition: ToolDefinition) => Promise<boolean>
  capabilityNotice?: () => Promise<string | null>
  releaseVolatileImage?: (assetId: string) => void
}

export type ExecuteToolsOptions = {
  toolRuntime: GraphToolRuntime | undefined
  modelObserver(taskId: string): ModelEventObserver | undefined
  toolObserver(taskId: string): ToolEventObserver | undefined
  streamRequestId(taskId: string): string | undefined
}

export function createExecuteToolsNode(options: ExecuteToolsOptions) {
  return async (state: typeof AgentState.State, config: { signal?: AbortSignal }) => {
    const results: RuntimeMessage[] = []
    const screenshots: ImageAssetRef[] = []
    let activeActivityId = state.activeActivityId
    let activityTitleRevision = state.activityTitleRevision
    let activityCapturesProgress = state.activityCapturesProgress
    let activityToolNames = state.activityToolNames
    let activityIssueCount = state.activityIssueCount
    // A picture is a visible block, so it ends the current tool group exactly like prose
    // does: the next round's tools must start a new group instead of joining this one.
    let emittedVisibleBlock = false
    for (const [index, providerCall] of state.pendingToolCalls.entries()) {
      if (config.signal?.aborted) throw config.signal.reason
      if (!options.toolRuntime) {
        return { error: 'TOOL_CALLS_NOT_CONFIGURED', trace: ['executeTools'] }
      }
      activityToolNames = [...activityToolNames, providerCall.modelName]
      const toolTitle = activityTitleForTools(state.goal, activityToolNames)
      if (activeActivityId) {
        activityTitleRevision += 1
        await options.modelObserver(state.taskId)?.({
          kind: 'activity',
          event: {
            type: 'updated',
            activityId: activeActivityId,
            title: toolTitle,
            titleRevision: activityTitleRevision
          }
        })
      } else {
        activeActivityId =
          state.toolRound === 1 && index === 0
            ? defaultActivityId(state.taskId)
            : nextActivityId(state.taskId, state.toolRound, index)
        activityTitleRevision = 1
        activityCapturesProgress = false
        await options.modelObserver(state.taskId)?.({
          kind: 'activity',
          event: {
            type: 'started',
            activityId: activeActivityId,
            title: toolTitle,
            titleRevision: activityTitleRevision
          }
        })
      }
      const call = parseToolCall({
        callId: `tool:${state.taskId}:${state.toolRound}:${index}`,
        providerCallId: providerCall.providerCallId,
        modelName: providerCall.modelName,
        arguments: providerCall.arguments
      })
      let terminal: Extract<
        ToolEvent,
        { type: 'tool.completed' | 'tool.failed' | 'tool.cancelled' | 'tool.unknown' }
      > | null = null
      const printed = { stdout: '', stderr: '', result: '' }
      try {
        for await (const toolEvent of options.toolRuntime.invocations.execute(
          call,
          {
            taskId: state.taskId,
            threadId: state.threadId,
            checkpointId: `tool:${state.toolRound}`,
            requestId:
              options.streamRequestId(state.taskId) ?? `plan:${state.taskId}:${state.toolRound}`,
            grants: state.toolGrants,
            activityId: activeActivityId,
            ...(options.toolObserver(state.taskId)
              ? { onEvent: options.toolObserver(state.taskId)! }
              : {})
          },
          config.signal
        )) {
          if (
            toolEvent.type === 'tool.completed' ||
            toolEvent.type === 'tool.failed' ||
            toolEvent.type === 'tool.cancelled' ||
            toolEvent.type === 'tool.unknown'
          ) {
            terminal = toolEvent
          }
          // A failing tool keeps what it printed before failing, for the model and for history.
          if (toolEvent.type === 'tool.content') printed[toolEvent.stream] += toolEvent.delta
          // Screenshots a Computer Use cell emits stay in memory and are shown to the next
          // model request only; history keeps just the handle.
          if (toolEvent.type === 'tool.asset' && isVolatileComputerImage(toolEvent.asset))
            screenshots.push(toolEvent.asset)
          else if (toolEvent.type === 'tool.asset') emittedVisibleBlock = true
        }
      } catch (error) {
        if (config.signal?.aborted) throw error
        terminal = {
          type: 'tool.failed',
          callId: call.callId,
          taskId: state.taskId,
          sequence: 0,
          error: {
            code:
              error instanceof Error && 'code' in error ? String(error.code) : 'TOOL_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
            retryable: false
          }
        }
      }
      const redact = toolRedaction(options.toolRuntime, providerCall.modelName)
      results.push({
        role: 'tool',
        toolCallId: providerCall.providerCallId,
        name: providerCall.modelName,
        content: JSON.stringify(
          terminal?.type === 'tool.completed'
            ? {
                ok: true,
                output: redact ? redactCollectedOutput(redact, terminal.output) : terminal.output
              }
            : {
                ok: false,
                ...(terminal?.type === 'tool.unknown'
                  ? {
                      outcome: 'unknown',
                      recovery:
                        'Side effects may have occurred. Verify current state before retrying.'
                    }
                  : {}),
                error:
                  terminal?.type === 'tool.failed' ||
                  terminal?.type === 'tool.cancelled' ||
                  terminal?.type === 'tool.unknown'
                    ? redact
                      ? redactToolError(terminal.error)
                      : terminal.error
                    : { code: 'TOOL_NO_TERMINAL' },
                ...(printed.stdout || printed.stderr || printed.result
                  ? {
                      output: {
                        stdout: printed.stdout,
                        stderr: printed.stderr,
                        content: printed.result
                      }
                    }
                  : {})
              }
        )
      })
      if (terminal?.type !== 'tool.completed') activityIssueCount += 1
      activityTitleRevision += 1
      await options.modelObserver(state.taskId)?.({
        kind: 'activity',
        event: {
          type: 'updated',
          activityId: activeActivityId,
          title: activityTitleForTools(
            state.goal,
            activityToolNames,
            terminal?.type === 'tool.completed'
              ? 'completed'
              : terminal?.type === 'tool.cancelled'
                ? 'cancelled'
                : 'failed',
            activityIssueCount
          ),
          titleRevision: activityTitleRevision
        }
      })
    }
    if (emittedVisibleBlock && activeActivityId) {
      await options.modelObserver(state.taskId)?.({
        kind: 'activity',
        event: { type: 'completed', activityId: activeActivityId }
      })
      activeActivityId = null
      activityTitleRevision = 0
      activityToolNames = []
      activityIssueCount = 0
    }
    return {
      modelMessages: [
        ...state.modelMessages,
        { role: 'assistant' as const, toolCalls: state.pendingToolCalls },
        ...results,
        ...screenshots.map(
          (asset): RuntimeMessage => ({
            role: 'user',
            content: [
              {
                kind: 'text',
                text: 'Screenshot from the previous js call.'
              },
              { kind: 'image', asset }
            ]
          })
        )
      ],
      pendingToolCalls: [],
      activeActivityId,
      activityTitleRevision,
      activityCapturesProgress,
      activityToolNames,
      activityIssueCount,
      trace: ['executeTools']
    }
  }
}

function toolRedaction(
  runtime: GraphToolRuntime | undefined,
  modelName: string
): ToolRedaction | undefined {
  try {
    const { executor } = runtime!.registry.resolveModelName(modelName)
    return executor.redactForPersistence?.bind(executor)
  } catch {
    return undefined
  }
}
