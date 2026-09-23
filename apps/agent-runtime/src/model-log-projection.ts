import type {
  ModelLogCallProjection,
  ModelLogSessionProjection,
  ModelRunStatus,
  RecentTaskProjection,
  SkillExecutionState,
  TaskProjection
} from '@actiondriver/contracts'
import type { PersistedMessage, PersistedModelCall, RuntimeTaskRecord } from './ports'

export function buildTaskProjection(
  task: RuntimeTaskRecord,
  messages: readonly PersistedMessage[]
): TaskProjection {
  const status = toTaskStatus(task.status)
  return {
    id: task.id,
    sessionId: task.sessionId,
    title: task.goal,
    status,
    model: task.model,
    messages: messages.flatMap((message) => {
      const content = messageText(message.content)
      if (content === null) return []
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return [
        {
          id: message.id,
          role: message.role === 'assistant' ? ('agent' as const) : ('user' as const),
          content
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
    browser: null
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

export function buildModelLogSessionProjection(
  taskOrTasks: RuntimeTaskRecord | readonly RuntimeTaskRecord[],
  messages: readonly PersistedMessage[],
  modelCalls: readonly PersistedModelCall[]
): ModelLogSessionProjection {
  const tasks = (Array.isArray(taskOrTasks) ? taskOrTasks : [taskOrTasks]).slice().sort(taskOrder)
  const first = tasks[0]
  const latest = tasks.at(-1)
  if (!first || !latest) throw new Error('At least one task is required for a model log session')
  const projectedTasks = tasks.map((task) => {
    const calls = modelCalls
      .filter((call) => call.taskId === task.id)
      .sort(
        (left, right) =>
          left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
      )
      .map((call) =>
        buildCallProjection(
          task,
          messages.filter((message) => message.taskId === task.id),
          call
        )
      )
    const status = toModelStatus(task.status)
    const startTime = calls[0]?.time ?? task.createdAt
    const endTime = terminalEndTime(status, calls.at(-1)?.time ? task.updatedAt : task.updatedAt)
    return {
      id: task.id,
      sessionId: task.sessionId,
      name: task.goal,
      startTime,
      ...(endTime ? { endTime } : {}),
      status,
      durationMs: durationBetween(startTime, endTime),
      model: task.model,
      calls
    }
  })
  const status = toModelStatus(latest.status)
  const startTime = projectedTasks[0]?.startTime ?? first.createdAt
  const endTime = terminalEndTime(status, projectedTasks.at(-1)?.endTime ?? latest.updatedAt)
  return {
    id: first.sessionId,
    sessionId: first.sessionId,
    name: first.goal,
    startTime,
    ...(endTime ? { endTime } : {}),
    status,
    durationMs: durationBetween(startTime, endTime),
    tasks: projectedTasks
  }
}

function taskOrder(left: RuntimeTaskRecord, right: RuntimeTaskRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function buildCallProjection(
  task: RuntimeTaskRecord,
  messages: readonly PersistedMessage[],
  call: PersistedModelCall
): ModelLogCallProjection {
  const requestMessages = readRequestMessages(call.request)
  const systemPrompt = requestMessages.find((message) => message.role === 'system')?.content ?? ''
  const storedUserMessage = messages.find(
    (message) => message.role === 'user' && messageText(message.content) !== null
  )
  const userInput =
    messageText(storedUserMessage?.content) ??
    requestMessages.find((message) => message.role === 'user')?.content ??
    task.goal
  const metadata = {
    taskId: call.taskId,
    requestId: call.requestId,
    correlationId: call.correlationId,
    connectionId: call.model.connectionId,
    modelId: call.model.modelId,
    status: call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
    durationMs: durationBetween(call.startedAt, call.completedAt),
    ...(call.status === 'failed' ? { error: call.error } : {})
  }
  const sections: ModelLogCallProjection['sections'] = [
    {
      id: 'system-prompt',
      title: '系统提示词',
      content: systemPrompt,
      language: 'text'
    },
    { id: 'user-input', title: '用户输入', content: String(userInput), language: 'text' },
    {
      id: 'model-request',
      title: '模型请求',
      content: prettyJson(call.request),
      language: 'json'
    },
    ...(call.status === 'failed'
      ? []
      : [
          {
            id: 'model-response' as const,
            title: '模型响应',
            content: prettyJson(call.response),
            language: 'json' as const
          }
        ]),
    {
      id: 'metadata',
      title: call.status === 'failed' ? '错误与元数据' : '元数据',
      content: prettyJson(metadata),
      language: 'json'
    }
  ]
  return {
    id: call.id,
    taskId: call.taskId,
    requestId: call.requestId,
    correlationId: call.correlationId,
    label: call.model.modelId,
    time: call.startedAt,
    status: call.status,
    description:
      call.status === 'failed'
        ? (errorMessage(call.error) ?? '模型调用失败')
        : call.status === 'completed'
          ? '模型调用完成'
          : '模型调用中',
    sections
  }
}

function readRequestMessages(
  request: unknown
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (!request || typeof request !== 'object' || !('messages' in request)) return []
  const messages = (request as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const candidate = message as { role?: unknown; content?: unknown }
    if (
      (candidate.role !== 'system' &&
        candidate.role !== 'user' &&
        candidate.role !== 'assistant') ||
      typeof candidate.content !== 'string'
    ) {
      return []
    }
    return [{ role: candidate.role, content: candidate.content }]
  })
}

function toTaskStatus(status: string): SkillExecutionState {
  if (status === 'completed') return 'succeeded'
  if (status === 'waiting-user') return 'waiting-user'
  if (status === 'interrupted') return 'paused'
  if (status === 'failed') return 'failed'
  return 'running'
}

function toModelStatus(status: string): ModelRunStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'running'
}

function terminalEndTime(status: ModelRunStatus, endTime: string | null): string | null {
  return status === 'running' ? null : endTime
}

function durationBetween(start: string, end: string | null): number | null {
  if (!end) return null
  const duration = Date.parse(end) - Date.parse(start)
  return Number.isFinite(duration) && duration >= 0 ? duration : null
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

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function messageText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!content || typeof content !== 'object' || !('text' in content)) return null
  return typeof content.text === 'string' ? content.text : null
}
