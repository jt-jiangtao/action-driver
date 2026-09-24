import type { AgentMessageProjection } from '@actiondriver/contracts'
import { MarkdownContent } from '../MarkdownContent'
import { ConversationImage, type ImageReader } from './ConversationImage'

export function AgentResponse({
  message,
  generating = false,
  readImage
}: {
  message: AgentMessageProjection
  generating?: boolean
  readImage?: ImageReader | undefined
}) {
  if (
    generating &&
    message.content.length === 0 &&
    !message.parts?.some((part) => part.kind === 'image')
  ) {
    return (
      <div className="agent-message agent-generating" role="status" aria-live="polite">
        正在生成
      </div>
    )
  }
  if (message.parts?.some((part) => part.kind === 'image'))
    return (
      <div className="agent-message agent-message-with-images">
        {message.parts.map((part, index) =>
          part.kind === 'image' ? (
            <ConversationImage
              key={`${part.asset.assetId}:${index}`}
              asset={part.asset}
              readImage={readImage}
            />
          ) : part.text ? (
            <MarkdownContent
              key={`text:${index}`}
              className="markdown-content"
              content={part.text}
            />
          ) : null
        )}
      </div>
    )
  return <MarkdownContent className="agent-message markdown-content" content={message.content} />
}
