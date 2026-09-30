import type { PersistedStreamRequest, RuntimeEventRecord } from '@action-driver/agent-runtime/ports'
import {
  applyRolloutLine,
  emptyRolloutState,
  type RolloutSessionState,
  type RolloutTurnState
} from './fold'
import type { BlockLine, RolloutLine, ToolLine } from './model'

/**
 * Turns domain records back into the runtime events the stream protocol already
 * speaks. The rollout stays the single source of truth, while live delivery and
 * reconnect replay keep consuming exactly the same `RuntimeEventRecord` shape.
 */
export function deriveRolloutEvents(
  lines: readonly RolloutLine[],
  request: PersistedStreamRequest
): RuntimeEventRecord[] {
  const events: RuntimeEventRecord[] = []
  const state = emptyRolloutState()
  for (const line of lines) {
    // Every record folds first: session metadata (the turn's model) and other turns belong to
    // the same log and must be applied even when they emit nothing for this request.
    applyRolloutLine(state, line)
    events.push(...deriveRolloutEventsForLine(line, request, state, events.length))
  }
  return events
}

/** Derive one post-fold line using the same mapping as full replay. */
export function deriveRolloutEventsForLine(
  line: RolloutLine,
  request: PersistedStreamRequest,
  stateAfter: RolloutSessionState,
  firstSequence: number
): RuntimeEventRecord[] {
  if (!belongsToRequest(line, request)) return []
  const turn = stateAfter.turns.find((candidate) => candidate.turnId === request.taskId)
  // Acceptance and narration can precede the turn record that anchors them.
  if (!turn && line.t !== 'event' && line.t !== 'message' && line.t !== 'activity_text') return []
  return lineToEvents(line, turn, stateAfter.model).map((event, index) => {
    const sequence = firstSequence + index
    return {
      cursor: line.seq,
      taskId: request.taskId,
      threadId: request.sessionId,
      checkpointId: request.responseId,
      eventKey: `${line.seq}:${sequence}:${event.type}`,
      occurredAt: line.ts,
      eventId: `${request.requestId}:${line.seq}:${sequence}:${event.type}`,
      requestId: request.requestId,
      responseId: request.responseId,
      streamId: request.streamId,
      messageId: request.messageId,
      sequence,
      ...event
    }
  })
}

function belongsToRequest(line: RolloutLine, request: PersistedStreamRequest): boolean {
  if (line.t === 'session_meta' || line.t === 'session_state') return false
  return line.turnId === request.taskId
}

/**
 * How many protocol frames one record publishes. Mirrors `lineToEvents`; the store uses it to keep
 * a request's sequence watermark without folding the whole log on every append.
 */
export function countRolloutEvents(line: RolloutLine): number {
  if (line.t === 'session_meta' || line.t === 'session_state') return 0
  if (line.t === 'turn_begin' || line.t === 'turn_end' || line.t === 'event') return 1
  if (line.t === 'message') return 0
  if (line.t === 'activity_text')
    return line.delta === undefined ? (line.phase === undefined ? 0 : 1) : 1
  if (line.t === 'tool') return 1
  if (line.kind === 'text') return line.delta === undefined ? 0 : 1
  if (line.kind === 'image_batch') return 1
  if (line.kind === 'image') return line.asset ? 1 : 0
  if (line.kind === 'document') return 0
  if (line.status === 'completed') return 1
  return line.title === undefined ? 0 : 1
}

function lineToEvents(
  line: RolloutLine,
  turn: RolloutTurnState | undefined,
  model: { connectionId: string; modelId: string } | null
): Array<{ type: string; payload: unknown }> {
  if (line.t === 'session_meta' || line.t === 'session_state') return []
  if (line.t === 'turn_begin') {
    return [{ type: 'response.start', payload: { model } }]
  }
  if (line.t === 'turn_end') {
    return [
      {
        type: 'response.end',
        payload: {
          status: line.status,
          content: line.content ?? turn?.finalContent ?? '',
          finishReason: null,
          usage: null,
          durationMs: line.durationMs ?? 0,
          error: line.error ?? null
        }
      }
    ]
  }
  if (line.t === 'event') return [{ type: line.type, payload: line.payload }]
  if (line.t === 'message') return []
  if (line.t === 'activity_text') {
    if (line.delta === undefined)
      return line.phase === undefined
        ? []
        : [
            {
              type: 'activity.text.done',
              payload: {
                activityId: line.activityId ?? null,
                textId: line.textId,
                phase: line.phase
              }
            }
          ]
    return [
      {
        type: 'activity.text',
        payload: {
          activityId: line.activityId ?? null,
          textId: line.textId,
          delta: line.delta
        }
      }
    ]
  }
  if (line.t === 'block') {
    if (!turn) return []
    const contentIndex = blockIndex(turn, line)
    if (line.kind === 'text') {
      if (line.delta === undefined) return []
      return [
        {
          type: 'response.content',
          payload: { delta: line.delta, contentIndex, order: line.order }
        }
      ]
    }
    if (line.kind === 'image_batch') {
      return [
        {
          type: 'response.image_batch',
          payload: {
            callId: line.callId,
            imageCount: line.imageCount,
            contentIndex,
            order: line.order
          }
        }
      ]
    }
    if (line.kind === 'image') {
      // An image whose asset never landed (write failure) must not be published.
      if (!line.asset) return []
      return [
        {
          type: 'response.image',
          payload: {
            asset: line.asset,
            contentIndex,
            callId: line.generation?.callId,
            index: line.generation?.index ?? 0,
            order: line.order
          }
        }
      ]
    }
    if (line.kind === 'tool_group') {
      if (line.status === 'completed')
        return [{ type: 'activity.completed', payload: { activityId: line.blockId } }]
      // A group materialized from a tool record carries no title: it only anchors the transcript,
      // so the model's own activity records stay the single source of the published lifecycle.
      if (line.title === undefined) return []
      const payload = {
        activityId: line.blockId,
        title: line.title ?? turn.goal,
        titleRevision: Math.max(1, line.titleRevision ?? 1)
      }
      return [
        {
          type: payload.titleRevision > 1 ? 'activity.updated' : 'activity.started',
          payload
        }
      ]
    }
    return []
  }
  if (line.t !== 'tool') return []
  // A tool keeps the request-scoped call sequence it was invoked with, not the replayed index.
  return [{ type: `tool.${line.status}`, payload: toolPayload(line, line.itemIndex) }]
}

function toolPayload(line: ToolLine, callSequence: number): Record<string, unknown> {
  return {
    callId: line.callId,
    toolId: line.toolId,
    modelName: line.modelName,
    summary: line.summary ?? line.toolId,
    ...(line.title === undefined ? {} : { title: line.title }),
    argumentsHash: line.argumentsHash ?? '',
    activityId: line.blockId,
    callSequence,
    ...(line.imageCount === undefined ? {} : { imageCount: line.imageCount }),
    ...(line.rawInput === undefined ? {} : { rawInput: line.rawInput }),
    ...(line.input === undefined ? {} : { input: line.input }),
    ...(line.output === undefined ? {} : { output: line.output }),
    ...(line.presentation === undefined ? {} : { presentation: line.presentation }),
    ...(line.rawOutput === undefined ? {} : { rawOutput: line.rawOutput }),
    ...(line.rawOutputTruncated === undefined
      ? {}
      : { rawOutputTruncated: line.rawOutputTruncated }),
    ...(line.durationMs === undefined ? {} : { durationMs: line.durationMs }),
    ...(line.resultSummary === undefined ? {} : { resultSummary: line.resultSummary }),
    ...(line.errorSummary === undefined
      ? {}
      : { error: { code: 'tool-failed', message: line.errorSummary, retryable: false } })
  }
}

/** Index of the block among the turn's blocks in `order`, i.e. the streamed part index. */
function blockIndex(turn: RolloutTurnState, line: BlockLine): number {
  const ordered = [...turn.blocks].sort((left, right) => left.order - right.order)
  const index = ordered.findIndex((block) => block.blockId === line.blockId)
  return index < 0 ? 0 : index
}
