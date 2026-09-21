import type { AgentMessageProjection } from '@actiondriver/contracts'

export function UserMessage({ message }: { message: AgentMessageProjection }) {
  return <div className="user-message">{message.content}</div>
}
