import { memo } from 'react'
import type { AgentMessageProjection, ToolInvocationProjection } from '@action-driver/contracts'
import { MarkdownContent } from '../MarkdownContent'
import type { ImageReader } from './ConversationImage'
import { ImageGallery } from './ImageGallery'
import { planMessageMedia } from '../../models/message-media'

const NO_TOOLS: ToolInvocationProjection[] = []

export const AgentResponse = memo(function AgentResponse({
  message,
  tools = NO_TOOLS,
  readImage
}: {
  message: AgentMessageProjection
  tools?: ToolInvocationProjection[]
  readImage?: ImageReader | undefined
}) {
  // What this message shows is decided once, without touching the DOM.
  const { hasMedia, blocks } = planMessageMedia(message, tools)
  if (!hasMedia)
    return message.content ? (
      <MarkdownContent className="agent-message markdown-content" content={message.content} />
    ) : null
  return (
    <div className="agent-message agent-message-with-images">
      {blocks.map((block) =>
        block.kind === 'text' ? (
          <MarkdownContent
            key={block.key}
            className="markdown-content"
            content={block.text}
          />
        ) : (
          <ImageGallery
            key={block.key}
            images={block.images}
            tools={block.tools}
            readImage={readImage}
          />
        )
      )}
    </div>
  )
})
