import type { AgentMessageProjection } from '@actiondriver/contracts'

export function AgentResponse({ message }: { message: AgentMessageProjection }) {
  return <p className="agent-message">{message.content}</p>
}
