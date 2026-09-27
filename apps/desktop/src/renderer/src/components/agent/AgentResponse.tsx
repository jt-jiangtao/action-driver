import { memo, type ReactNode } from 'react'
import type {
  AgentMessageProjection,
  MessageContentPart,
  ToolInvocationProjection
} from '@actiondriver/contracts'
import { MarkdownContent } from '../MarkdownContent'
import type { ImageReader } from './ConversationImage'
import { ImageGallery } from './ImageGallery'

type ImagePart = Extract<MessageContentPart, { kind: 'image' }>

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
  const parts = message.parts
  const images = parts?.filter((part): part is ImagePart => part.kind === 'image') ?? []
  const activeTools = tools.filter((tool) => tool.toolId === 'tools.local.image-generation.generate' && tool.imageCount && !['proposed', 'waiting_approval', 'queued'].includes(tool.status))
  const hasBlocks =
    images.length > 0 ||
    activeTools.length > 0 ||
    Boolean(parts?.some((part) => part.kind === 'image-batch'))
  if (!hasBlocks)
    return message.content ? (
      <MarkdownContent className="agent-message markdown-content" content={message.content} />
    ) : null
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
    if (part.kind === 'activity') {
      // Tool groups render in the activity area; the anchor only records where
      // they ran so prose and images keep the order the runtime assigned.
      return
    }
    if (part.kind === 'image-batch') {
      if (shownCalls.has(part.callId)) return
      shownCalls.add(part.callId)
      const tool = activeTools.find((candidate) => candidate.callId === part.callId) ?? {
        callId: part.callId, toolId: 'tools.local.image-generation.generate', modelName: 'tools.local.image-generation.generate',
        summary: '生成图片', argumentsHash: '', imageCount: part.imageCount,
        status: 'completed' as const
      }
      blocks.push(<ImageGallery key={`batch-${part.callId}`} images={images.filter((image) => image.generation?.callId === part.callId)} tools={[{ ...tool, imageCount: part.imageCount }]} readImage={readImage} />)
      return
    }
    if (part.kind === 'document') {
      // Attached documents are rendered by the input and result cards added in a later task.
      return
    }
    const callId = part.generation?.callId
    // With an anchor the image renders under that anchor; without one (legacy
    // messages) it keeps its own place so nothing hops across the text.
    if (callId && anchoredCalls.has(callId)) return
    if (callId) shownCalls.add(callId)
    blocks.push(<ImageGallery key={`image-${index}`} images={[part]} readImage={readImage} />)
  })
  const pendingTools = activeTools.filter(
    (tool) => !shownCalls.has(tool.callId) && !anchoredCalls.has(tool.callId)
  )
  if (pendingTools.length) blocks.push(<ImageGallery key="pending-batches" images={[]} tools={pendingTools} readImage={readImage} />)
  return <div className="agent-message agent-message-with-images">{blocks}</div>
})
