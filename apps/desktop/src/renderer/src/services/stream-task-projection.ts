import type { TaskProjection, ToolInvocationProjection } from '@actiondriver/contracts'
import type { StreamServerEvent } from '@actiondriver/runtime-contracts'

type ScheduledHandle = unknown

export class StreamTaskProjection {
  private task: TaskProjection | null = null
  private readonly buffered: StreamServerEvent[] = []
  private readonly seenEventIds = new Set<string>()
  private readonly toolSequences = new Map<string, number>()
  private lastSequence = -1
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

    if (event.type === 'response.snapshot') {
      if (event.sequence < this.lastSequence) return
      this.seenEventIds.add(event.eventId)
      this.lastSequence = event.sequence
      this.toolSequences.clear()
      this.task = {
        ...this.task,
        status: toTaskStatus(event.status),
        messages: event.messages.map((message) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'agent' : 'user',
          content: message.content
        })),
        tools: event.tools?.map((tool) => ({ callId: tool.callId, toolId: tool.toolId, modelName: tool.modelName, summary: tool.summary, argumentsHash: tool.argumentsHash, status: tool.status, durationMs: tool.durationMs, ...(tool.resultSummary === undefined ? {} : { resultSummary: tool.resultSummary }), ...(tool.errorSummary === undefined ? {} : { errorSummary: tool.errorSummary }) })) ?? this.task.tools ?? []
      }
      this.flush()
      return
    }
    if (event.type.startsWith('tool.')) {
      const toolEvent = event as Extract<StreamServerEvent, { type: `tool.${string}` }>
      if (toolEvent.callSequence <= (this.toolSequences.get(toolEvent.callId) ?? -1)) return
      this.seenEventIds.add(event.eventId)
      this.toolSequences.set(toolEvent.callId, toolEvent.callSequence)
      if (toolEvent.type !== 'tool.content') {
        const status = toolEvent.type.slice('tool.'.length) as ToolInvocationProjection['status']
        const next: ToolInvocationProjection = {
          callId: toolEvent.callId,
          toolId: toolEvent.toolId,
          modelName: toolEvent.modelName,
          summary: toolEvent.summary,
          argumentsHash: toolEvent.argumentsHash,
          status,
          ...(toolEvent.type === 'tool.completed' ? { durationMs: toolEvent.durationMs, resultSummary: toolEvent.resultSummary } : toolEvent.type === 'tool.failed' || toolEvent.type === 'tool.cancelled' ? { errorSummary: toolEvent.error?.message ?? '工具已取消' } : {})
        }
        this.task = {
          ...this.task,
          tools: (this.task.tools ?? []).some((tool) => tool.callId === next.callId) ? (this.task.tools ?? []).map((tool) => tool.callId === next.callId ? next : tool) : [...(this.task.tools ?? []), next]
        }
        this.flush()
      }
      return
    }
    if (
      event.type !== 'response.start' &&
      event.type !== 'response.content' &&
      event.type !== 'response.end'
    ) {
      return
    }
    if (event.messageId !== this.assistantMessage(event.messageId)?.id) return
    if (event.sequence <= this.lastSequence || event.sequence !== this.lastSequence + 1) return

    this.seenEventIds.add(event.eventId)
    this.lastSequence = event.sequence
    if (event.type === 'response.start') {
      this.task = { ...this.task, status: 'running' }
      this.scheduleEmit()
      return
    }
    if (event.type === 'response.content') {
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
      steps: [
        ...this.task.steps.map((step) =>
          step.state === 'current'
            ? { ...step, state: completed ? ('success' as const) : ('failed' as const), detail }
            : step
        )
      ]
    }
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
}

function toTaskStatus(status: 'running' | 'completed' | 'failed' | 'cancelled') {
  if (status === 'completed') return 'succeeded' as const
  if (status === 'cancelled') return 'paused' as const
  return status
}
