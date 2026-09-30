import type { ModelInputMessage } from '@action-driver/model-connections'
import type { StreamSessionRepository } from '../ports'
import { messageText } from './stream-values'

/** Build the model context only from turns that have reached a terminal state. */
export async function readSessionHistory(
  repositories: Pick<StreamSessionRepository, 'tasks' | 'messages'>,
  sessionId: string
): Promise<ModelInputMessage[]> {
  const [tasks, messages] = await Promise.all([
    repositories.tasks.listBySession(sessionId),
    repositories.messages.listBySession(sessionId)
  ])
  const terminalTaskIds = new Set(
    tasks.filter((task) => task.status !== 'running').map((task) => task.id)
  )
  return messages.flatMap<ModelInputMessage>((message): ModelInputMessage[] => {
    if (!terminalTaskIds.has(message.taskId)) return []
    if (message.role !== 'user' && message.role !== 'assistant') return []
    return message.role === 'user'
      ? [{ role: 'user' as const, content: messageText(message.content) }]
      : [{ role: 'assistant' as const, content: messageText(message.content) }]
  })
}
