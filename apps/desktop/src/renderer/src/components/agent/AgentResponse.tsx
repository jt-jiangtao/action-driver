import type { AgentMessageProjection } from '@actiondriver/contracts'
import { MarkdownContent } from '../MarkdownContent'

export function AgentResponse({
  message,
  generating = false
}: {
  message: AgentMessageProjection
  generating?: boolean
}) {
  if (generating && message.content.length === 0) {
    return (
      <div className="agent-message agent-generating" role="status" aria-live="polite">
        正在生成
      </div>
    )
  }
  return <MarkdownContent className="agent-message markdown-content" content={message.content} />
}
