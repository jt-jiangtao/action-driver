import { canonicalToolId } from '@actiondriver/plugin-contracts'
import { PluginError } from '@actiondriver/plugin-contracts'
import { z } from 'zod'
import {
  parseToolCall,
  type ToolCall,
  type ToolError,
  type ToolEvent,
  type ToolExecutionContext
} from '@actiondriver/runtime-contracts'
import type { InteractionLogRecorder } from '@actiondriver/observability'
import type {
  Clock,
  PersistedToolInvocation,
  RuntimeEventRecord,
  ToolInvocationPersistence
} from './ports'
import type { RuntimeToolRegistry } from './tool-registry'
import type { RuntimeToolPolicy } from './tool-policy'
import { ToolInvocationStateMachine } from './tool-invocation-state-machine'
import { ToolOutputCollector, ToolOutputLimitError } from './tool-output-collector'
import { redactCollectedOutput, redactToolError, type ToolJson } from './tool-result-redaction'
import { toolActivityDurationMs, toolActivitySummary, toolActivityTitle } from './tool-activity'
import { ProcessExitError, ProcessOutputLimitError } from './execution/process-runner'
import { OfficeDependenciesUnavailableError } from './execution/runtime-paths'
import { ExecutionContextUnavailableError } from './execution/session-execution-context'

export type ToolInvocationContext = {
  taskId: string
  threadId: string
  checkpointId: string
  requestId: string
  grants: string[]
  activityId?: string | null
  onEvent?: (event: RuntimeEventRecord) => void | Promise<void>
}

export class ToolInvocationService {
  private readonly maxOutputBytes: number

  constructor(
    private readonly options: {
      registry: RuntimeToolRegistry
      policy: RuntimeToolPolicy
      persistence: ToolInvocationPersistence
      interactions?: InteractionLogRecorder
      clock: Clock
      maxOutputBytes?: number
      executionContext?: (taskId: string) => Promise<ToolExecutionContext>
    }
  ) {
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  }

  async *execute(
    proposedCall: ToolCall,
    context: ToolInvocationContext,
    signal?: AbortSignal
  ): AsyncIterable<ToolEvent> {
    const call = parseToolCall(proposedCall)
    const registered = this.options.registry.resolveModelName(call.modelName)
    const definition = registered.definition
    const decision = this.options.policy.decide(definition, call, context)
    const imageCount =
      definition.id === 'tools.local.image-generation.generate' && Array.isArray(call.arguments.images)
        ? call.arguments.images.length
        : undefined
    const startedAt = this.options.clock.now()
    const invocation: PersistedToolInvocation = {
      id: call.callId,
      providerCallId: call.providerCallId,
      taskId: context.taskId,
      toolId: definition.id,
      toolVersion: definition.version,
      argumentsHash: '',
      decision: decision.kind === 'deny' ? 'deny' : decision.kind,
      status: 'proposed',
      input: call.arguments,
      output: null,
      error: null,
      createdAt: startedAt,
      updatedAt: startedAt
    }
    const machine = new ToolInvocationStateMachine()
    let sequence = 0
    // History and events only ever see the executor's safe summary; the caller keeps full values.
    const redact = registered.executor.redactForPersistence?.bind(registered.executor)
    const safeInput = () => (redact ? redact('input', call.arguments as ToolJson) : call.arguments)
    const persistedOutput = (output: unknown): unknown => redactCollectedOutput(redact, output)
    const persist = async (event: ToolEvent): Promise<ToolEvent> => {
      invocation.updatedAt = this.options.clock.now()
      const stored: PersistedToolInvocation = {
        ...invocation,
        error: redact && invocation.error ? redactToolError(invocation.error) : invocation.error,
        input: safeInput() as PersistedToolInvocation['input'],
        output: persistedOutput(invocation.output) as PersistedToolInvocation['output']
      }
      const safeEvent =
        redact && 'error' in event ? { ...event, error: redactToolError(event.error) } : event
      const storedEvent =
        'output' in safeEvent
          ? { ...safeEvent, output: persistedOutput(safeEvent.output) }
          : redact && safeEvent.type === 'tool.content'
            ? { ...safeEvent, delta: `[redacted ${safeEvent.delta.length} characters]` }
            : safeEvent
      const record = await this.options.persistence.commitToolInvocationWithEvent(stored, {
        taskId: context.taskId,
        threadId: context.threadId,
        checkpointId: context.checkpointId,
        eventKey: `${call.callId}.${event.sequence}`,
        type: event.type,
        payload: {
          ...storedEvent,
          toolId: definition.id,
          modelName: definition.modelName,
          summary: toolActivitySummary(definition.id, call.arguments),
          title: toolActivityTitle(definition.id, call.arguments, invocation.status),
          durationMs: toolActivityDurationMs(invocation.createdAt, invocation.updatedAt),
          argumentsHash: invocation.argumentsHash,
          activityId: context.activityId ?? null,
          ...(imageCount && imageCount >= 1 && imageCount <= 16 ? { imageCount } : {}),
          input: safeInput()
        },
        occurredAt: invocation.updatedAt,
        eventId: `${call.callId}.${event.sequence}`,
        requestId: context.requestId,
        sequence: event.sequence
      })
      await context.onEvent?.(record)
      return event
    }
    const event = (type: ToolEvent['type'], extra: Record<string, unknown> = {}): ToolEvent =>
      ({
        type,
        callId: call.callId,
        taskId: context.taskId,
        sequence: sequence++,
        ...extra
      }) as ToolEvent
    const transition = async (
      status: PersistedToolInvocation['status'],
      extra: Record<string, unknown> = {}
    ): Promise<ToolEvent> => {
      invocation.status = machine.transition(status)
      return persist(event(`tool.${status}` as ToolEvent['type'], extra))
    }

    yield await persist(event('tool.proposed'))
    const finishLog = this.options.interactions
      ? await this.options.interactions.start({
          transport: 'http',
          direction: 'service->skill',
          operation: definition.id,
          requestId: context.requestId,
          taskId: context.taskId,
          request: { kind: 'json', value: safeInput() }
        })
      : null
    const completeLog = async (outcome: 'ok' | 'error', error?: ToolError): Promise<void> => {
      await finishLog?.({
        outcome,
        ...(invocation.output === null
          ? {}
          : { response: { kind: 'json', value: persistedOutput(invocation.output) } as const }),
        ...(error
          ? {
              error: {
                code: error.code,
                message: redact ? redactToolError(error).message : error.message
              }
            }
          : {})
      })
    }

    if (decision.kind === 'deny') {
      invocation.error = decision.error
      yield await transition('failed', { error: decision.error })
      await completeLog('error', decision.error)
      return
    }

    let inputValid = false
    try {
      const inputSchema = z.fromJSONSchema({
        ...definition.inputSchema,
        additionalProperties: definition.inputSchema.additionalProperties ?? false
      } as Parameters<typeof z.fromJSONSchema>[0])
      inputValid = inputSchema.safeParse(call.arguments).success
    } catch {
      inputValid = false
    }
    if (!inputValid) {
      const error = toolError('TOOL_INPUT_INVALID', 'Tool arguments do not match the input schema')
      invocation.error = error
      yield await transition('failed', { error })
      await completeLog('error', error)
      return
    }

    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    const timeout = setTimeout(
      () => controller.abort(new Error('TOOL_TIMEOUT')),
      definition.timeoutMs
    )
    const collector = new ToolOutputCollector(this.maxOutputBytes)
    try {
      if (controller.signal.aborted) throw controller.signal.reason
      yield await transition('queued')
      yield await transition('running')
      const executionContext = this.options.executionContext
        ? await this.options.executionContext(context.taskId)
        : undefined
      for await (const part of registered.executor.execute(
        { ...call, modelName: definition.modelName },
        controller.signal,
        executionContext ? { ...executionContext, grants: context.grants.map(canonicalToolId) } : undefined
      )) {
        if (controller.signal.aborted) throw controller.signal.reason
        if (part.kind === 'asset') {
          yield await persist(event('tool.asset', { index: part.index, asset: part.asset }))
          continue
        }
        collector.add(part)
        if (part.kind === 'content') {
          yield await persist(event('tool.content', { stream: part.stream, delta: part.delta }))
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason
      invocation.output = collector.snapshot()
      yield await transition('completed', { output: invocation.output })
      await completeLog('ok')
    } catch (caught) {
      // Once completed, the state is terminal: a later failure (for example storage rejecting the
      // result) must surface as itself rather than as an impossible completed -> failed transition.
      if (machine.state === 'completed') throw caught
      if (caught instanceof ToolOutputLimitError) {
        invocation.output = caught.output
        controller.abort(caught)
      }
      if (caught instanceof ProcessOutputLimitError) {
        invocation.output = { ...collector.snapshot(), truncated: true }
        controller.abort(caught)
      }
      if (caught instanceof ProcessExitError) {
        invocation.output = { ...collector.snapshot(), result: { exitCode: caught.exitCode } }
      }
      // Whatever the tool printed before failing stays with the failure, so history and the model
      // both keep the diagnostics instead of only the error.
      if (invocation.output === null) invocation.output = collector.snapshot()
      const timedOut =
        controller.signal.aborted &&
        !signal?.aborted &&
        controller.signal.reason instanceof Error &&
        controller.signal.reason.message === 'TOOL_TIMEOUT'
      const cancelled =
        !timedOut && (signal?.aborted || (caught instanceof Error && caught.name === 'AbortError'))
      const unknown = caught instanceof PluginError && caught.code === 'RESULT_UNKNOWN'
      const error =
        unknown
          ? toolError('TOOL_OUTCOME_UNKNOWN', caught.message)
          : caught instanceof PluginError && !cancelled && !timedOut
            ? toolError(caught.code, caught.message)
          : caught instanceof ToolOutputLimitError
          ? toolError(caught.code, caught.message)
          : caught instanceof ProcessOutputLimitError
            ? toolError(caught.code, caught.message)
            : caught instanceof ProcessExitError
              ? toolError(caught.code, caught.message)
              : timedOut
                ? toolError('TOOL_TIMEOUT', 'Tool execution timed out')
                : caught instanceof OfficeDependenciesUnavailableError
                  ? toolError(caught.code, caught.message)
                  : caught instanceof ExecutionContextUnavailableError
                    ? toolError(caught.code, caught.message)
                    : toolError(
                        cancelled ? 'TOOL_CANCELLED' : 'TOOL_EXECUTION_FAILED',
                        caught instanceof Error ? caught.message : String(caught)
                      )
      invocation.error = error
      yield await transition(unknown ? 'unknown' : cancelled ? 'cancelled' : 'failed', { error })
      await completeLog('error', error)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function toolError(code: string, message: string): ToolError {
  return { code, message, retryable: false }
}
