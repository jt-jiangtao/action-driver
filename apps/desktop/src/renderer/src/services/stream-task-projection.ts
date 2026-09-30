import { projectToolDetails } from '@action-driver/plugin-contracts'
import {
  appendActivityAnchor,
  currentActivityId,
  insertPartByOrder,
  nextPartOrder,
  normalizeAssistantParts,
  type MessageContentPart,
  type TaskProjection,
  type ToolInvocationProjection
} from '@action-driver/contracts'
import {
  emptyActivityTimelineState,
  reduceActivityProjection,
  type ActivityTimelineState
} from '@action-driver/activity-projection'
import type { StreamServerEvent } from '@action-driver/runtime-contracts'

type ScheduledHandle = unknown

/**
 * Reduces the stream of one task into an immutable projection.
 *
 * Ordering and de-duplication are the transport's job: `RendererStreamClient`
 * delivers every request event exactly once, in sequence, before it reaches this
 * reducer. The reducer therefore keeps no seen-id/cursor ledger of its own; it
 * only buffers events that arrive while the task it belongs to is still being
 * created.
 */
export class StreamTaskProjection {
  private task: TaskProjection | null = null
  private readonly buffered: StreamServerEvent[] = []
  private readonly toolStreams = new Map<string, Record<string, string>>()
  private readonly toolSequences = new Map<string, number>()
  private activityState: ActivityTimelineState = emptyActivityTimelineState()
  private scheduled: ScheduledHandle | null = null

  constructor(
    private readonly options: {
      onChange(task: TaskProjection): void
      schedule?: (callback: () => void, delayMs: number) => ScheduledHandle
      cancelScheduled?: (handle: ScheduledHandle) => void
    }
  ) {}

  attach(task: TaskProjection): void {
    this.toolStreams.clear()
    this.task = structuredClone(task)
    this.task.messages = this.task.messages.map((message) =>
      message.role === 'agent' && message.parts
        ? { ...message, parts: normalizeAssistantParts(message.parts) }
        : message
    )
    this.activityState = activityStateFromTask(task, task.streamCursor ?? 0)
    const events = this.buffered.splice(0)
    const cursor = task.streamCursor ?? 0
    // The snapshot handed to `attach` already contains everything up to its
    // cursor, so buffered events that it covers must not be applied twice.
    for (const event of events) {
      if ('cursor' in event && event.type !== 'response.snapshot' && event.cursor <= cursor)
        continue
      this.apply(event)
    }
  }

  apply(event: StreamServerEvent): void {
    if (!this.task) {
      this.buffered.push(structuredClone(event))
      return
    }
    if (!('taskId' in event) || event.taskId !== this.task.id) return

    if (event.type === 'response.snapshot') {
      this.toolSequences.clear()
      this.toolStreams.clear()
      this.activityState = activityStateFromTask(
        {
          ...this.task,
          activities: event.activities ?? [],
          activityTimeline: event.activityTimeline ?? [],
          tools: event.tools?.map(toToolProjection) ?? []
        },
        event.cursor
      )
      const currentTask = this.task
      this.task = {
        ...currentTask,
        ...(event.preparingToolName ? { preparingToolName: event.preparingToolName } : {}),
        status: toTaskStatus(event.status),
        pendingAppApproval: event.status === 'running' ? (event.pendingAppApproval ?? []) : [],
        streamCursor: event.cursor,
        streamSequence: event.sequence,
        messages: event.messages.map((message) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'agent' : 'user',
          content: message.content,
          ...(message.parts
            ? {
                parts:
                  message.role === 'assistant'
                    ? normalizeAssistantParts(message.parts)
                    : message.parts
              }
            : {})
        })),
        tools: event.tools?.map(toToolProjection) ?? currentTask.tools ?? [],
        ...(event.durationMs === undefined ? {} : { activityDurationMs: event.durationMs }),
        ...(event.activities ? { activities: event.activities } : {}),
        ...(event.activityTimeline ? { activityTimeline: event.activityTimeline } : {}),
        ...(event.outputFiles
          ? {
              outputFiles: event.outputFiles.map((file) => ({
                fileId: file.fileId,
                sessionId: file.sessionId,
                taskId: file.taskId,
                ...(file.uri ? { uri: file.uri } : {}),
                name: file.name,
                mimeType: file.mimeType,
                byteLength: file.byteLength,
                kind: file.mimeType.startsWith('image/')
                  ? ('image' as const)
                  : ('document' as const)
              }))
            }
          : {})
      }
      if (!event.preparingToolName) delete this.task.preparingToolName
      this.flush()
      return
    }
    this.recordCursor(event.cursor)
    this.task = { ...this.task, streamSequence: event.sequence }
    if (event.type === 'computer.app-approval.requested') {
      if (
        event.approval.taskId !== this.task.id ||
        event.approval.sessionId !== this.task.sessionId
      )
        return
      this.task = {
        ...this.task,
        pendingAppApproval: [
          ...(this.task.pendingAppApproval ?? []).filter(
            (approval) => approval.requestId !== event.approval.requestId
          ),
          event.approval
        ]
      }
      this.flush()
      return
    }
    if (event.type === 'computer.app-approval.resolved') {
      this.task = {
        ...this.task,
        pendingAppApproval: (this.task.pendingAppApproval ?? []).filter(
          (approval) => approval.requestId !== event.approval.requestId
        )
      }
      this.flush()
      return
    }
    if (event.type === 'request.accepted') {
      this.flush()
      return
    }
    if (event.type.startsWith('activity.')) {
      delete this.task.preparingToolName
      if (event.cursor <= this.activityState.cursor) return
      this.applyActivityProjection(event)
      this.flush()
      return
    }
    if (event.type.startsWith('tool.')) {
      delete this.task.preparingToolName
      const toolEvent = event as Extract<StreamServerEvent, { type: `tool.${string}` }>
      if (toolEvent.cursor <= this.activityState.cursor) return
      this.applyActivityProjection(toolEvent)
      if (toolEvent.callSequence <= (this.toolSequences.get(toolEvent.callId) ?? -1)) return
      this.toolSequences.set(toolEvent.callId, toolEvent.callSequence)
      this.anchorToolGroup(toolEvent.messageId, toolEvent.activityId)
      const previous = this.task.tools?.find((tool) => tool.callId === toolEvent.callId)
      const presentation = toolEvent.presentation ?? previous?.presentation
      let details = toolEvent.details
      const retainedImages =
        previous?.details?.output.filter((field) => field.kind === 'image') ?? []
      if (toolEvent.type === 'tool.content' && details && presentation) {
        let streams = this.toolStreams.get(toolEvent.callId)
        if (!streams) {
          streams = {}
          try {
            const output = JSON.parse(previous?.rawOutput ?? '{}')
            for (const key of ['stdout', 'stderr', 'result'])
              if (typeof output[key] === 'string') streams[key] = output[key]
          } catch {
            /* bounded legacy JSON may be incomplete */
          }
        }
        streams[toolEvent.stream] = ((streams[toolEvent.stream] ?? '') + toolEvent.delta).slice(
          0,
          64 * 1024
        )
        this.toolStreams.set(toolEvent.callId, streams)
        // Server details can already contain the authoritative aggregate after replay or reload.
        const projected = projectToolDetails(presentation, undefined, streams)
        if (!details.output.length && !details.truncated)
          details = {
            ...details,
            output: projected.output,
            ...(projected.truncated ? { truncated: true } : {})
          }
      }
      if (details) {
        details = {
          ...details,
          input: details.input.length ? details.input : (previous?.details?.input ?? []),
          output: details.output.length ? details.output : (previous?.details?.output ?? [])
        }
        const output =
          toolEvent.type === 'tool.asset'
            ? [
                ...(previous?.details?.output ?? []),
                ...(toolEvent.details?.output ?? []).filter(
                  (field) =>
                    !previous?.details?.output.some(
                      (existing) =>
                        existing.asset?.assetId === field.asset?.assetId && field.kind === 'image'
                    )
                )
              ]
            : [...details.output]
        for (const image of retainedImages)
          if (!output.some((field) => field.asset?.assetId === image.asset?.assetId)) {
            if (output.length < 100) output.push(image)
            else details.truncated = true
          }
        details = {
          ...details,
          output: output.slice(0, 100),
          ...(output.length > 100 ? { truncated: true } : {})
        }
      }
      if (toolEvent.type === 'tool.content' || toolEvent.type === 'tool.asset') {
        if (previous && details) {
          const next = { ...previous, details, ...(presentation ? { presentation } : {}) }
          this.task = {
            ...this.task,
            tools: (this.task.tools ?? []).map((tool) =>
              tool.callId === next.callId ? next : tool
            )
          }
          this.scheduleEmit()
        }
      } else {
        const status = toolEvent.type.slice('tool.'.length) as ToolInvocationProjection['status']
        const next: ToolInvocationProjection = {
          ...(details ? { details } : {}),
          ...(presentation ? { presentation } : {}),
          callId: toolEvent.callId,
          toolId: toolEvent.toolId,
          modelName: toolEvent.modelName,
          summary: toolEvent.summary,
          ...(toolEvent.title === undefined ? {} : { title: toolEvent.title }),
          argumentsHash: toolEvent.argumentsHash,
          ...(toolEvent.imageCount === undefined ? {} : { imageCount: toolEvent.imageCount }),
          activityId: toolEvent.activityId,
          ...(toolEvent.rawInput === undefined ? {} : { rawInput: toolEvent.rawInput }),
          ...(toolEvent.type === 'tool.completed' && toolEvent.rawOutput !== undefined
            ? { rawOutput: toolEvent.rawOutput }
            : {}),
          ...(toolEvent.rawOutputTruncated === undefined
            ? {}
            : { rawOutputTruncated: toolEvent.rawOutputTruncated }),
          status,
          ...(toolEvent.type === 'tool.completed'
            ? { durationMs: toolEvent.durationMs, resultSummary: toolEvent.resultSummary }
            : toolEvent.type === 'tool.failed' ||
                toolEvent.type === 'tool.cancelled' ||
                toolEvent.type === 'tool.unknown'
              ? { errorSummary: toolEvent.error?.message ?? '工具已取消' }
              : {})
        }
        this.task = {
          ...this.task,
          tools: (this.task.tools ?? []).some((tool) => tool.callId === next.callId)
            ? (this.task.tools ?? []).map((tool) => (tool.callId === next.callId ? next : tool))
            : [...(this.task.tools ?? []), next]
        }
        this.flush()
      }
      return
    }
    if (event.type === 'runtime.interrupted') {
      this.task = {
        ...this.task,
        status: 'failed',
        pendingAppApproval: [],
        steps: this.task.steps.map((step) =>
          step.state === 'current'
            ? { ...step, state: 'failed', detail: event.error.message }
            : step
        )
      }
      delete this.task.preparingToolName
      this.flush()
      return
    }
    if (
      event.type !== 'response.start' &&
      event.type !== 'response.content' &&
      event.type !== 'response.image_batch' &&
      event.type !== 'response.image' &&
      event.type !== 'response.tool_preparing' &&
      event.type !== 'response.end'
    ) {
      this.flush()
      return
    }
    if (event.messageId !== this.assistantMessage(event.messageId)?.id) return
    if (event.type === 'response.start') {
      this.task = {
        ...this.task,
        status: 'running',
        activityStartedAt: event.occurredAt,
        streamSequence: event.sequence
      }
      delete this.task.preparingToolName
      this.scheduleEmit()
      return
    }
    if (event.type === 'response.tool_preparing') {
      this.task = { ...this.task, preparingToolName: event.modelName }
      this.scheduleEmit()
      return
    }
    if (event.type === 'response.content') {
      this.task = { ...this.task, streamSequence: event.sequence }
      delete this.task.preparingToolName
      const before = this.assistantMessage(event.messageId)
      const parts = before?.parts
        ? [...before.parts]
        : before?.content
          ? [{ kind: 'text' as const, text: before.content }]
          : []
      // Text flows strictly forward: it continues the trailing text block or
      // starts a new block at its own order, so text that streams after an image
      // batch stays after it no matter when the pictures land.
      const last = parts.at(-1)
      // Emitted snapshots share their parts, so the trailing block is replaced, never edited.
      if (last?.kind === 'text')
        parts[parts.length - 1] = { ...last, text: last.text + event.delta }
      else
        insertPartByOrder(parts, {
          kind: 'text',
          text: event.delta,
          order: event.order ?? nextPartOrder(parts)
        })
      this.replaceAssistantContent(event.messageId, `${before?.content ?? ''}${event.delta}`)
      this.replaceAssistantParts(event.messageId, normalizeAssistantParts(parts))
      this.scheduleEmit()
      return
    }

    if (event.type === 'response.image_batch') {
      const assistant = this.assistantMessage(event.messageId)
      const parts = assistant?.parts
        ? [...assistant.parts]
        : assistant?.content
          ? [{ kind: 'text' as const, text: assistant.content }]
          : []
      if (!parts.some((part) => part.kind === 'image-batch' && part.callId === event.callId)) {
        insertPartByOrder(parts, {
          kind: 'image-batch',
          callId: event.callId,
          imageCount: event.imageCount,
          order: event.order ?? nextPartOrder(parts)
        })
        this.replaceAssistantParts(event.messageId, normalizeAssistantParts(parts))
      }
      this.flush()
      return
    }

    if (event.type === 'response.image') {
      const assistant = this.assistantMessage(event.messageId)
      const parts = assistant?.parts
        ? [...assistant.parts]
        : assistant?.content
          ? [{ kind: 'text' as const, text: assistant.content }]
          : []
      if (
        !parts.some((part) => part.kind === 'image' && part.asset.assetId === event.asset.assetId)
      ) {
        // The batch reserved one order per image, so an image keeps the place
        // it was planned for even when a later slot finishes first.
        insertPartByOrder(parts, {
          kind: 'image',
          asset: event.asset,
          generation: { callId: event.callId, index: event.index },
          order: event.order ?? imageOrderIn(parts, event.callId, event.index)
        })
        this.replaceAssistantParts(event.messageId, normalizeAssistantParts(parts))
      }
      this.flush()
      return
    }

    this.replaceAssistantContent(event.messageId, event.content)
    // The streamed order is canonical: a finished turn must not move text that
    // already had a position, otherwise the live message would differ from the
    // same message after a reload. Only an answer the model never streamed is
    // appended, mirroring how the runtime stores the transcript.
    const completedParts = this.assistantMessage(event.messageId)?.parts
    if (event.status === 'completed' && completedParts?.length) {
      const hasVisual = completedParts.some(
        (part) => part.kind === 'image' || part.kind === 'image-batch'
      )
      const streamedText = completedParts
        .filter((part) => part.kind === 'text')
        .map((part) => part.text)
        .join('')
      if (
        hasVisual &&
        event.content &&
        (!streamedText ||
          (!streamedText.endsWith(event.content) && !event.content.endsWith(streamedText)))
      ) {
        this.replaceAssistantParts(
          event.messageId,
          normalizeAssistantParts([
            ...completedParts,
            { kind: 'text', text: event.content, order: nextPartOrder(completedParts) }
          ])
        )
      }
    }
    const completed = event.status === 'completed'
    const detail = completed
      ? '模型响应已完成'
      : (event.error?.message ?? (event.status === 'cancelled' ? '任务已取消' : '模型响应失败'))
    this.task = {
      ...this.task,
      status: toTaskStatus(event.status),
      pendingAppApproval: [],
      streamSequence: event.sequence,
      ...(event.type === 'response.end' ? { activityDurationMs: event.durationMs } : {}),
      ...(event.type === 'response.end' && event.outputFiles
        ? {
            outputFiles: event.outputFiles.map((file) => ({
              fileId: file.fileId,
              sessionId: file.sessionId,
              taskId: file.taskId,
              ...(file.uri ? { uri: file.uri } : {}),
              name: file.name,
              mimeType: file.mimeType,
              byteLength: file.byteLength,
              kind: file.mimeType.startsWith('image/') ? ('image' as const) : ('document' as const)
            }))
          }
        : {}),
      steps: [
        ...this.task.steps.map((step) =>
          step.state === 'current'
            ? { ...step, state: completed ? ('success' as const) : ('failed' as const), detail }
            : step
        )
      ]
    }
    delete this.task.preparingToolName
    this.flush()
  }

  flush(): void {
    if (!this.task) return
    if (this.scheduled !== null) {
      ;(this.options.cancelScheduled ?? clearTimeout)(this.scheduled as never)
      this.scheduled = null
    }
    this.options.onChange(this.snapshot()!)
  }

  snapshot(): TaskProjection | null {
    return this.task
  }

  private assistantMessage(messageId: string) {
    return this.task?.messages.find(
      (message) => message.id === messageId && message.role === 'agent'
    )
  }

  /** Keeps the tool group in the transcript where its tools ran. */
  private anchorToolGroup(messageId: string, activityId: string | null | undefined): void {
    if (!activityId) return
    const assistant = this.assistantMessage(messageId)
    if (!assistant) return
    const parts = assistant.parts
      ? [...assistant.parts]
      : assistant.content
        ? [{ kind: 'text' as const, text: assistant.content }]
        : []
    if (currentActivityId(parts) === activityId) return
    appendActivityAnchor(parts, activityId)
    this.replaceAssistantParts(messageId, normalizeAssistantParts(parts))
  }

  private replaceAssistantContent(messageId: string, content: string): void {
    if (!this.task) return
    const assistant = this.assistantMessage(messageId)
    if (!assistant) return
    this.task = {
      ...this.task,
      messages: this.task.messages.map((message) =>
        message.id === assistant.id ? { ...message, content } : message
      )
    }
  }

  private replaceAssistantParts(
    messageId: string,
    parts: NonNullable<TaskProjection['messages'][number]['parts']>
  ): void {
    if (!this.task) return
    this.task = {
      ...this.task,
      messages: this.task.messages.map((message) =>
        message.id === messageId ? { ...message, parts } : message
      )
    }
  }

  private scheduleEmit(): void {
    if (this.scheduled !== null) return
    const schedule = this.options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.scheduled = schedule(() => {
      this.scheduled = null
      if (this.task) this.options.onChange(this.snapshot()!)
    }, 75)
  }

  private recordCursor(cursor: number): void {
    if (this.task) this.task = { ...this.task, streamCursor: cursor }
  }

  private applyActivityProjection(event: StreamServerEvent): void {
    if (!this.task) return
    this.activityState = reduceActivityProjection(this.activityState, event)
    this.task = {
      ...this.task,
      activities: this.activityState.activities,
      activityTimeline: this.activityState.timeline
    }
  }
}

/**
 * Order reserved for one image of a batch: the batch owns `index` slots so a
 * picture never has to be moved once it is on screen.
 */
function imageOrderIn(parts: readonly MessageContentPart[], callId: string, index: number): number {
  const batch = parts.find((part) => part.kind === 'image-batch' && part.callId === callId)
  return batch?.order === undefined ? nextPartOrder(parts) : batch.order + 1 + index
}

function activityStateFromTask(task: TaskProjection, cursor = 0): ActivityTimelineState {
  const state = emptyActivityTimelineState(cursor)
  state.activities = structuredClone(task.activities ?? [])
  state.timeline = structuredClone(task.activityTimeline ?? [])
  for (const tool of task.tools ?? []) state.toolActivityIds[tool.callId] = tool.activityId ?? null
  for (const activity of state.activities) {
    for (const item of activity.items) {
      if (item.kind === 'text')
        state.textPhases[item.id.replace(/^text:/, '')] = item.phase ?? 'pending'
    }
  }
  return state
}

function toToolProjection(
  tool: NonNullable<Extract<StreamServerEvent, { type: 'response.snapshot' }>['tools']>[number]
): ToolInvocationProjection {
  return {
    ...(tool.details ? { details: tool.details } : {}),
    ...(tool.presentation ? { presentation: tool.presentation } : {}),
    callId: tool.callId,
    toolId: tool.toolId,
    modelName: tool.modelName,
    summary: tool.summary,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    argumentsHash: tool.argumentsHash,
    ...(tool.imageCount === undefined ? {} : { imageCount: tool.imageCount }),
    status: tool.status,
    durationMs: tool.durationMs,
    ...(tool.resultSummary === undefined ? {} : { resultSummary: tool.resultSummary }),
    ...(tool.errorSummary === undefined ? {} : { errorSummary: tool.errorSummary }),
    ...(tool.activityId === undefined ? {} : { activityId: tool.activityId }),
    ...(tool.rawInput === undefined ? {} : { rawInput: tool.rawInput }),
    ...(tool.rawOutput === undefined ? {} : { rawOutput: tool.rawOutput }),
    ...(tool.rawOutputTruncated === undefined
      ? {}
      : { rawOutputTruncated: tool.rawOutputTruncated })
  }
}

function toTaskStatus(status: 'running' | 'completed' | 'failed' | 'cancelled') {
  if (status === 'completed') return 'succeeded' as const
  if (status === 'cancelled') return 'paused' as const
  return status
}
