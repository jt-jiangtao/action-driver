import type { AgentMessageProjection, ToolInvocationProjection } from '@actiondriver/contracts'
import { MarkdownContent } from '../MarkdownContent'
import type { ImageReader } from './ConversationImage'
import { ImageGallery } from './ImageGallery'

export function AgentResponse({
  message,
  generating = false,
  tools = [],
  readImage
}: {
  message: AgentMessageProjection
  generating?: boolean
  tools?: ToolInvocationProjection[]
  readImage?: ImageReader | undefined
}) {
  const images = message.parts?.filter((part) => part.kind === 'image') ?? []
  const hasGallery = images.length > 0 || tools.some((tool) => tool.toolId === 'image.generate' && tool.imageCount && !['proposed', 'waiting_approval', 'queued'].includes(tool.status))
  if (
    generating &&
    message.content.length === 0 &&
    !hasGallery
  ) {
    return (
      <div className="agent-message agent-generating" role="status" aria-live="polite">
        正在生成
      </div>
    )
  }
  if (hasGallery)
    return (
      <div className="agent-message agent-message-with-images">
        {message.content ? <MarkdownContent className="markdown-content" content={message.content} /> : null}
        <ImageGallery images={images} tools={tools} readImage={readImage} />
      </div>
    )
  return <MarkdownContent className="agent-message markdown-content" content={message.content} />
}
