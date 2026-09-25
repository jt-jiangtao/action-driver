import type { ReactNode } from 'react'
import type { AgentMessageProjection, MessageContentPart, ToolInvocationProjection } from '@actiondriver/contracts'
import { MarkdownContent } from '../MarkdownContent'
import type { ImageReader } from './ConversationImage'
import { ImageGallery } from './ImageGallery'

type ImagePart = Extract<MessageContentPart, { kind: 'image' }>

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
  const parts = message.parts
  const images = parts?.filter((part): part is ImagePart => part.kind === 'image') ?? []
  const activeTools = tools.filter((tool) => tool.toolId === 'image.generate' && tool.imageCount && !['proposed', 'waiting_approval', 'queued'].includes(tool.status))
  const hasGallery = images.length > 0 || activeTools.length > 0 || Boolean(parts?.some((part) => part.kind === 'image-batch'))
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
  if (!hasGallery) return <MarkdownContent className="agent-message markdown-content" content={message.content} />
  if (!parts?.length)
    return (
      <div className="agent-message agent-message-with-images">
        {message.content ? <MarkdownContent className="markdown-content" content={message.content} /> : null}
        <ImageGallery images={images} tools={activeTools} readImage={readImage} />
      </div>
    )

  const anchoredCalls = new Set(parts.filter((part) => part.kind === 'image-batch').map((part) => part.callId))
  const shownCalls = new Set<string>()
  const blocks: ReactNode[] = []
  parts.forEach((part, index) => {
    if (part.kind === 'text') {
      if (part.text) blocks.push(<MarkdownContent className="markdown-content" content={part.text} key={`text-${index}`} />)
      return
    }
    if (part.kind === 'image-batch') {
      if (shownCalls.has(part.callId)) return
      shownCalls.add(part.callId)
      const tool = activeTools.find((candidate) => candidate.callId === part.callId) ?? {
        callId: part.callId, toolId: 'image.generate', modelName: 'image_generate',
        summary: '生成图片', argumentsHash: '', imageCount: part.imageCount,
        status: 'completed' as const
      }
      blocks.push(<ImageGallery key={`batch-${part.callId}`} images={images.filter((image) => image.generation?.callId === part.callId)} tools={[{ ...tool, imageCount: part.imageCount }]} readImage={readImage} />)
      return
    }
    const callId = part.generation?.callId
    if (callId && anchoredCalls.has(callId)) return
    if (callId) {
      shownCalls.add(callId)
      blocks.push(<ImageGallery key={`legacy-call-${callId}-${index}`} images={[part]} readImage={readImage} />)
    } else {
      blocks.push(<ImageGallery key={`legacy-image-${index}`} images={[part]} readImage={readImage} />)
    }
  })
  const pendingTools = activeTools.filter((tool) => !shownCalls.has(tool.callId))
  if (pendingTools.length) blocks.push(<ImageGallery key="pending-batches" images={[]} tools={pendingTools} readImage={readImage} />)
  return <div className="agent-message agent-message-with-images">{blocks}</div>
}
