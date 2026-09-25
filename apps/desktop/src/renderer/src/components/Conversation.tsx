import type { AgentMessageProjection, ToolInvocationProjection } from '@actiondriver/contracts'
import { AgentResponse } from './agent/AgentResponse'
import { UserMessage } from './agent/UserMessage'
import type { ImageReader } from './agent/ConversationImage'

export { TaskHeader } from './agent/TaskHeader'

export function ConversationMessages({
  messages,
  tools = [],
  readImage
}: {
  messages: AgentMessageProjection[]
  tools?: ToolInvocationProjection[]
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
            tools={message.id === lastAgentId ? tools : []}
            readImage={readImage}
          />
        )
      )}
    </>
  )
}
