import type { AgentMessageProjection } from '@actiondriver/contracts'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'

export { TaskHeader } from './agent/TaskHeader'

export function ConversationMessages({ messages }: { messages: AgentMessageProjection[] }) {
  return (
    <>
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AgentResponse key={message.id} message={message} />
        )
      )}
    </>
  )
}
