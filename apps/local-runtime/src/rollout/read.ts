import type {
  PersistedMessage,
  PersistedStreamRequest,
  PersistedToolInvocation,
  RuntimeEventRecord,
  RuntimeTaskRecord,
  StreamSnapshotRead
} from '@action-driver/agent-runtime/ports'
import type { MessageContentPart } from '@action-driver/contracts'
import { deriveRolloutEvents } from './event-bridge'
import type { RolloutBlockState } from './fold'
import type { RolloutStoreContext } from './store-context'

export class RolloutReadOperations {
  constructor(private readonly context: RolloutStoreContext) {}

  async readStreamSnapshot(requestId: string): Promise<StreamSnapshotRead> {
    const request = this.context.requests.get(requestId)
    if (!request) throw new Error(`Unknown stream request: ${requestId}`)
    const runtime = this.context.ensureRuntime(request.sessionId)
    const lines = runtime?.lines ?? []
    const events = deriveRolloutEvents(lines, request)
    // Snapshots read this watermark, so it is refreshed whenever the log is folded rather than on
    // every append — folding the whole log per event would be quadratic across a long turn.
    const lastSequence = events.at(-1)?.sequence ?? null
    if (lastSequence !== null && lastSequence !== request.lastSequence) {
      const updated: PersistedStreamRequest = { ...request, lastSequence }
      this.context.requests.set(request.requestId, updated)
      this.context.projection.saveStreamRequest(updated)
    }
    let cursor = 0
    for (const event of events) cursor = Math.max(cursor, event.cursor)
    return {
      request,
      cursor,
      events,
      task: await this.taskRecord(request.taskId),
      messages: await this.messagesForTask(request.taskId),
      tools: await this.toolsForTask(request.taskId)
    }
  }

  async listAfter(cursor: number): Promise<RuntimeEventRecord[]> {
    const events: RuntimeEventRecord[] = []
    for (const request of this.context.requests.values()) {
      events.push(
        ...deriveRolloutEvents(this.context.ensureRuntime(request.sessionId)?.lines ?? [], request)
      )
    }
    return events
      .filter((event) => event.cursor > cursor)
      .sort((left, right) => left.cursor - right.cursor)
  }

  async listForRequestAfter(
    requestId: string,
    cursor: number,
    limit: number
  ): Promise<RuntimeEventRecord[]> {
    const request = this.context.requests.get(requestId)
    if (!request) return []
    const events = deriveRolloutEvents(
      this.context.ensureRuntime(request.sessionId)?.lines ?? [],
      request
    ).filter((event) => event.cursor > cursor)
    return events.slice(0, limit)
  }

  async taskRecord(taskId: string): Promise<RuntimeTaskRecord | null> {
    const sessionId =
      this.context.taskSessions.get(taskId) ??
      [...this.context.requests.values()].find((candidate) => candidate.taskId === taskId)
        ?.sessionId
    if (!sessionId) return null
    const state = this.context.ensureRuntime(sessionId)?.state
    const turn = state?.turns.find((candidate) => candidate.turnId === taskId)
    if (!turn) return null
    const request = [...this.context.requests.values()].find(
      (candidate) => candidate.taskId === taskId
    )
    return {
      id: taskId,
      threadId: sessionId,
      sessionId,
      goal: turn.goal,
      model: state?.model ?? { connectionId: '', modelId: '' },
      status: turn.status,
      error: turn.error,
      lastCheckpointId: null,
      createdAt: turn.startedAt ?? request?.createdAt ?? '',
      updatedAt: turn.completedAt ?? turn.startedAt ?? request?.createdAt ?? ''
    }
  }

  async latestTask(sessionId: string): Promise<RuntimeTaskRecord | null> {
    const tasks = await this.sessionTasks(sessionId)
    return tasks.at(-1) ?? null
  }

  async sessionTasks(sessionId: string): Promise<RuntimeTaskRecord[]> {
    const state = this.context.ensureRuntime(sessionId)?.state
    if (!state) return []
    const tasks: RuntimeTaskRecord[] = []
    for (const turn of state.turns) {
      const record = await this.taskRecord(turn.turnId)
      if (record) tasks.push(record)
    }
    return tasks
  }

  /** Recent sessions, newest first, one task (the latest turn) per session. */
  async recentTasks(limit: number): Promise<RuntimeTaskRecord[]> {
    const tasks: RuntimeTaskRecord[] = []
    for (const thread of this.context.projection.listThreads(limit)) {
      const latest = await this.latestTask(thread.sessionId)
      if (latest) tasks.push(latest)
    }
    return tasks
  }

  async messagesForTask(taskId: string): Promise<PersistedMessage[]> {
    const sessionId =
      this.context.taskSessions.get(taskId) ??
      [...this.context.requests.values()].find((candidate) => candidate.taskId === taskId)
        ?.sessionId
    if (!sessionId) return []
    const state = this.context.ensureRuntime(sessionId)?.state
    const turn = state?.turns.find((candidate) => candidate.turnId === taskId)
    if (!turn) return []
    const request = [...this.context.requests.values()].find(
      (candidate) => candidate.taskId === taskId
    )
    const stored: PersistedMessage[] = turn.messages.map((message) => ({
      id: message.messageId,
      taskId,
      role: message.role,
      content: message.content,
      createdAt: message.at
    }))
    const parts = turn.blocks.map((block) => blockToPart(block)).filter((part) => part !== null)
    if (parts.length === 0 && turn.finalContent.length === 0) return stored
    // A text-only turn keeps the plain `{ text }` shape; parts appear once the turn carries
    // images, documents or tool-group anchors.
    const structured = parts.some(
      (part) =>
        part.kind === 'image' ||
        part.kind === 'image-batch' ||
        part.kind === 'document' ||
        part.kind === 'activity'
    )
    const streamedText = parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('')
    const assistantId = request?.messageId ?? `assistant:${taskId}`
    const content = structured
      ? { parts }
      : { text: streamedText.length > 0 ? streamedText : turn.finalContent }
    const index = stored.findIndex(
      (message) => message.id === assistantId && message.role === 'assistant'
    )
    if (index >= 0) {
      // Keep the id the streamed events address; only the content grows.
      stored[index] = { ...stored[index]!, content }
      return stored
    }
    return [
      ...stored,
      {
        id: assistantId,
        taskId,
        role: 'assistant',
        content,
        createdAt: turn.completedAt ?? turn.startedAt ?? request?.createdAt ?? ''
      }
    ]
  }

  async toolsForTask(taskId: string): Promise<PersistedToolInvocation[]> {
    const sessionId =
      this.context.taskSessions.get(taskId) ??
      [...this.context.requests.values()].find((candidate) => candidate.taskId === taskId)
        ?.sessionId
    if (!sessionId) return []
    const state = this.context.ensureRuntime(sessionId)?.state
    const turn = state?.turns.find((candidate) => candidate.turnId === taskId)
    if (!turn) return []
    return [...turn.tools.values()].map((tool) => ({
      id: tool.callId,
      providerCallId: tool.callId,
      taskId,
      toolId: tool.toolId,
      toolVersion: 0,
      argumentsHash: tool.argumentsHash,
      decision: 'allow',
      status: tool.status,
      input: tool.input,
      output: tool.output,
      error: null,
      createdAt: turn.startedAt ?? '',
      updatedAt: turn.completedAt ?? turn.startedAt ?? ''
    }))
  }
}

function blockToPart(block: RolloutBlockState): MessageContentPart | null {
  if (block.kind === 'text') return { kind: 'text', text: block.text, order: block.order }
  if (block.kind === 'image_batch')
    return block.callId !== null && block.imageCount !== null
      ? {
          kind: 'image-batch',
          callId: block.callId,
          imageCount: block.imageCount,
          order: block.order
        }
      : null
  if (block.kind === 'image')
    return block.asset !== null
      ? {
          kind: 'image',
          asset: block.asset,
          ...(block.generation === null ? {} : { generation: block.generation }),
          order: block.order
        }
      : null
  if (block.kind === 'document')
    return block.file !== null ? { kind: 'document', file: block.file, order: block.order } : null
  // A tool group keeps an anchor part so a reopened transcript matches the live one.
  if (block.kind === 'tool_group')
    return { kind: 'activity', activityId: block.blockId, order: block.order }
  return null
}
