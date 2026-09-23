import type { AgentMessageProjection } from '@actiondriver/contracts'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'

export { TaskHeader } from './agent/TaskHeader'

export function ConversationMessages({
  messages,
  generating = false
}: {
  messages: AgentMessageProjection[]
  generating?: boolean
}) {
  const lastAgentId = [...messages].reverse().find((message) => message.role === 'agent')?.id
  return (
    <>
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AgentResponse
            key={message.id}
            message={message}
            generating={generating && message.id === lastAgentId}
          />
        )
      )}
    </>
  )
}
