import type { TaskProjection, ToolInvocationProjection } from '@actiondriver/contracts'
import {
  emptyActivityTimelineState,
  reduceActivityProjection,
  type ActivityTimelineState
} from '@actiondriver/activity-projection'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'

type ScheduledHandle = unknown

export class StreamTaskProjection {
  private task: TaskProjection | null = null
  private readonly buffered: StreamServerEvent[] = []
  private readonly seenEventIds = new Set<string>()
  private readonly toolSequences = new Map<string, number>()
  private activityState: ActivityTimelineState = emptyActivityTimelineState()
  private lastSequence = -1
  private lastCursor = 0
  private scheduled: ScheduledHandle | null = null

  constructor(
    private readonly options: {
      onChange(task: TaskProjection): void
      schedule?: (callback: () => void, delayMs: number) => ScheduledHandle
      cancelScheduled?: (handle: ScheduledHandle) => void
    }
  ) {}

  attach(task: TaskProjection): void {
    this.task = structuredClone(task)
    this.lastCursor = task.streamCursor ?? 0
    this.lastSequence = task.streamSequence ?? -1
    this.activityState = activityStateFromTask(task, this.lastCursor)
    const events = this.buffered.splice(0)
    for (const event of events) this.apply(event)
  }

  apply(event: StreamServerEvent): void {
    if (!this.task) {
      this.buffered.push(structuredClone(event))
      return
    }
    if (!('taskId' in event) || event.taskId !== this.task.id) return
    if (this.seenEventIds.has(event.eventId)) return
    if ('cursor' in event && event.type !== 'response.snapshot' && event.cursor <= this.lastCursor)
      return

    if (event.type === 'response.snapshot') {
      if (event.sequence < this.lastSequence) return
      this.seenEventIds.add(event.eventId)
      this.lastSequence = event.sequence
      this.lastCursor = event.cursor
      this.toolSequences.clear()
      this.activityState = activityStateFromTask(
        {
          ...this.task,
          activities: event.activities ?? [],
          activityTimeline: event.activityTimeline ?? [],
          tools: event.tools?.map(toToolProjection) ?? []
        },
        event.cursor
      )
      this.task = {
        ...this.task,
        ...(event.preparingToolName ? { preparingToolName: event.preparingToolName } : {}),
        status: toTaskStatus(event.status),
        streamCursor: event.cursor,
        streamSequence: event.sequence,
        messages: event.messages.map((message) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'agent' : 'user',
          content: message.content
        })),
        tools: event.tools?.map(toToolProjection) ?? this.task.tools ?? [],
        ...(event.durationMs === undefined ? {} : { activityDurationMs: event.durationMs }),
        ...(event.activities ? { activities: event.activities } : {}),
        ...(event.activityTimeline ? { activityTimeline: event.activityTimeline } : {})
      }
      if (!event.preparingToolName) delete this.task.preparingToolName
      this.flush()
      return
    }
    if (event.sequence !== this.lastSequence + 1) return
    this.seenEventIds.add(event.eventId)
    this.lastSequence = event.sequence
    this.recordCursor(event.cursor)
    this.task = { ...this.task, streamSequence: event.sequence }
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
      if (toolEvent.type !== 'tool.content') {
        const status = toolEvent.type.slice('tool.'.length) as ToolInvocationProjection['status']
        const next: ToolInvocationProjection = {
          callId: toolEvent.callId,
          toolId: toolEvent.toolId,
          modelName: toolEvent.modelName,
          summary: toolEvent.summary,
          ...(toolEvent.title === undefined ? {} : { title: toolEvent.title }),
          argumentsHash: toolEvent.argumentsHash,
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
      this.replaceAssistantContent(
        event.messageId,
        `${this.assistantMessage(event.messageId)?.content ?? ''}${event.delta}`
      )
      this.scheduleEmit()
      return
    }

    this.replaceAssistantContent(event.messageId, event.content)
    const completed = event.status === 'completed'
    const detail = completed
      ? '模型响应已完成'
      : (event.error?.message ?? (event.status === 'cancelled' ? '任务已取消' : '模型响应失败'))
    this.task = {
      ...this.task,
      status: toTaskStatus(event.status),
      streamSequence: event.sequence,
      ...(event.type === 'response.end' ? { activityDurationMs: event.durationMs } : {}),
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
    return this.task ? structuredClone(this.task) : null
  }

  private assistantMessage(messageId: string) {
    return this.task?.messages.find(
      (message) => message.id === messageId && message.role === 'agent'
    )
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

  private scheduleEmit(): void {
    if (this.scheduled !== null) return
    const schedule = this.options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.scheduled = schedule(() => {
      this.scheduled = null
      if (this.task) this.options.onChange(this.snapshot()!)
    }, 75)
  }

  private recordCursor(cursor: number): void {
    this.lastCursor = cursor
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
    callId: tool.callId,
    toolId: tool.toolId,
    modelName: tool.modelName,
    summary: tool.summary,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    argumentsHash: tool.argumentsHash,
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
