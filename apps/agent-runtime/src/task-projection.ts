import {
  readMessageContentParts,
  normalizeAssistantParts,
  type MessageContent,
  type MessageContentPart,
  type RecentTaskProjection,
  type SkillExecutionState,
  type TaskOutputFileProjection,
  type TaskProjection
} from '@actiondriver/contracts'
import type { PersistedMessage, RuntimeTaskRecord } from './ports'
import { legacyResourceUri } from './resources/media-providers'

export function buildTaskProjection(
  task: RuntimeTaskRecord,
  messages: readonly PersistedMessage[],
  outputFiles: readonly TaskOutputFileProjection[] = []
): TaskProjection {
  const status = toTaskStatus(task.status)
  return {
    id: task.id,
    sessionId: task.sessionId,
    title: task.goal,
    status,
    model: task.model,
    activityStartedAt: task.createdAt,
    messages: messages.flatMap((message) => {
      const content = messageText(message.content)
      if (content === null) return []
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return [
        {
          id: message.id,
          role: message.role === 'assistant' ? ('agent' as const) : ('user' as const),
          content,
          ...(messageParts(message.content) ? { parts: message.role === 'assistant' ? normalizeAssistantParts(messageParts(message.content)!) : messageParts(message.content)! } : {})
        }
      ]
    }),
    steps: [
      {
        id: `step:${task.id}:run`,
        title: 'Agent 执行',
        detail: stepDetail(task, status),
        state: status === 'succeeded' ? 'success' : status === 'failed' ? 'failed' : 'current'
      }
    ],
    browser: null,
    ...(outputFiles.length > 0 ? { outputFiles: [...outputFiles] } : {})
  }
}

export function toOutputFileProjection(file: {
  fileId: string
  sessionId: string
  taskId: string
  name: string
  mimeType: string
  byteLength: number
}): TaskOutputFileProjection {
  return {
    fileId: file.fileId,
    sessionId: file.sessionId,
    taskId: file.taskId,
    // The card carries the unified reference so a client can open it without the legacy triple,
    // while `fileId` keeps older cards working unchanged.
    uri: legacyResourceUri('generated-output', file.fileId, { sessionId: file.sessionId, taskId: file.taskId }),
    name: file.name,
    mimeType: file.mimeType,
    byteLength: file.byteLength,
    kind: file.mimeType.startsWith('image/') ? 'image' : 'document'
  }
}

export function buildRecentTaskProjection(
  task: RuntimeTaskRecord,
  title = task.goal
): RecentTaskProjection {
  return {
    id: task.id,
    sessionId: task.sessionId,
    title,
    status: toTaskStatus(task.status),
    model: task.model,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

function toTaskStatus(status: string): SkillExecutionState {
  if (status === 'completed') return 'succeeded'
  if (status === 'waiting-user') return 'waiting-user'
  if (status === 'interrupted' || status === 'cancelled') return 'paused'
  if (status === 'failed') return 'failed'
  return 'running'
}

function stepDetail(task: RuntimeTaskRecord, status: SkillExecutionState): string {
  if (status === 'succeeded') return '任务已完成'
  if (status === 'failed') return errorMessage(task.error) ?? '任务执行失败'
  if (status === 'paused') return '任务已暂停'
  if (status === 'waiting-user') return '等待用户输入'
  return 'Agent 正在执行'
}

function errorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('message' in error)) return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

function messageText(content: unknown): string | null {
  if (typeof content === 'string') return content
  const parts = messageParts(content)
  if (parts)
    return parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('')
  if (!content || typeof content !== 'object' || !('text' in content)) return null
  return typeof content.text === 'string' ? content.text : null
}

function messageParts(content: unknown): MessageContentPart[] | null {
  if (
    !content ||
    typeof content !== 'object' ||
    !('parts' in content) ||
    !Array.isArray(content.parts)
  )
    return null
  return readMessageContentParts(content as MessageContent)
}
