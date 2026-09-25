import { z } from 'zod'
import {
  parseToolCall,
  type ToolCall,
  type ToolError,
  type ToolEvent
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
import { toolActivityDurationMs, toolActivitySummary, toolActivityTitle } from './tool-activity'
import { ProcessExitError, ProcessOutputLimitError } from './execution/process-runner'

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
    const imageCount = definition.id === 'image.generate' && Array.isArray(call.arguments.images)
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
    const persist = async (event: ToolEvent): Promise<ToolEvent> => {
      invocation.updatedAt = this.options.clock.now()
      const record = await this.options.persistence.commitToolInvocationWithEvent(invocation, {
        taskId: context.taskId,
        threadId: context.threadId,
        checkpointId: context.checkpointId,
        eventKey: `${call.callId}.${event.sequence}`,
        type: event.type,
        payload: {
          ...event,
          toolId: definition.id,
          modelName: definition.modelName,
          summary: toolActivitySummary(definition.id, call.arguments),
          title: toolActivityTitle(definition.id, call.arguments, invocation.status),
          durationMs: toolActivityDurationMs(invocation.createdAt, invocation.updatedAt),
          argumentsHash: invocation.argumentsHash,
          activityId: context.activityId ?? null,
          ...(imageCount && imageCount >= 1 && imageCount <= 4 ? { imageCount } : {}),
          input: call.arguments
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
          request: { kind: 'json', value: call.arguments }
        })
      : null
    const completeLog = async (outcome: 'ok' | 'error', error?: ToolError): Promise<void> => {
      await finishLog?.({
        outcome,
        ...(invocation.output === null
          ? {}
          : { response: { kind: 'json', value: invocation.output } as const }),
        ...(error ? { error: { code: error.code, message: error.message } } : {})
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
      for await (const part of registered.executor.execute(call, controller.signal)) {
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
      const timedOut =
        controller.signal.aborted &&
        !signal?.aborted &&
        controller.signal.reason instanceof Error &&
        controller.signal.reason.message === 'TOOL_TIMEOUT'
      const cancelled =
        !timedOut && (signal?.aborted || (caught instanceof Error && caught.name === 'AbortError'))
      const error =
        caught instanceof ToolOutputLimitError
          ? toolError(caught.code, caught.message)
          : caught instanceof ProcessOutputLimitError
            ? toolError(caught.code, caught.message)
            : caught instanceof ProcessExitError
              ? toolError(caught.code, caught.message)
              : timedOut
                ? toolError('TOOL_TIMEOUT', 'Tool execution timed out')
                : toolError(
                    cancelled ? 'TOOL_CANCELLED' : 'TOOL_EXECUTION_FAILED',
                    caught instanceof Error ? caught.message : String(caught)
                  )
      invocation.error = error
      yield await transition(cancelled ? 'cancelled' : 'failed', { error })
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
