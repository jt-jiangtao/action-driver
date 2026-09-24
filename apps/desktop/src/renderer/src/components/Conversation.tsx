import type { AgentMessageProjection } from '@actiondriver/contracts'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'
import type { ImageReader } from './agent/ConversationImage'

export { TaskHeader } from './agent/TaskHeader'

export function ConversationMessages({
  messages,
  generating = false,
  readImage
}: {
  messages: AgentMessageProjection[]
  generating?: boolean
  readImage?: ImageReader | undefined
}) {
  const lastAgentId = [...messages].reverse().find((message) => message.role === 'agent')?.id
  return (
    <>
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} readImage={readImage} />
        ) : (
          <AgentResponse
            key={message.id}
            message={message}
            generating={generating && message.id === lastAgentId}
            readImage={readImage}
          />
        )
      )}
    </>
  )
}
