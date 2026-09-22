import type { AgentMessageProjection } from '@actiondriver/contracts'
import { MarkdownContent } from '../MarkdownContent'

export function AgentResponse({ message }: { message: AgentMessageProjection }) {
  return <MarkdownContent className="agent-message markdown-content" content={message.content} />
}
