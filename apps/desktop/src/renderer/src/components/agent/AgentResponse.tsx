import type { AgentMessageProjection } from '@actiondriver/contracts'

export function AgentResponse({ message }: { message: AgentMessageProjection }) {
  return <p className="agent-message" data-testid="agent-response">{message.content}</p>
}
