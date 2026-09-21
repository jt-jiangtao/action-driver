import type { AgentMessageProjection } from '@actiondriver/contracts'

export function UserMessage({ message }: { message: AgentMessageProjection }) {
  return <div className="user-message" data-testid="user-message">{message.content}</div>
}
