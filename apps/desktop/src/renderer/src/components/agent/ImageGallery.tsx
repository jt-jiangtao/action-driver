import type { MessageContentPart, ToolInvocationProjection } from '@actiondriver/contracts'
import { ConversationImage, type ImageReader } from './ConversationImage'
import { WanderingDots } from './WanderingDots'

type ImagePart = Extract<MessageContentPart, { kind: 'image' }>

export function ImageGallery({
  images,
  tools = [],
  readImage
}: {
  images: ImagePart[]
  tools?: ToolInvocationProjection[]
  readImage?: ImageReader | undefined
}) {
  const calls = tools.filter(
    (tool) =>
      tool.toolId === 'image.generate' &&
      tool.imageCount &&
      !['proposed', 'waiting_approval', 'queued'].includes(tool.status)
  )
  const grouped = new Set<ImagePart>()
  const groups = calls.map((tool) => {
    const slots = Array.from({ length: tool.imageCount! }, (_, index) => {
      const image = images.find(
        (part) => part.generation?.callId === tool.callId && part.generation.index === index
      )
      if (image) grouped.add(image)
      return { index, image }
    })
    return { tool, slots }
  })
  const remaining = images.filter((part) => !grouped.has(part))
  if (!groups.length && !remaining.length) return null
  return (
    <div className="image-gallery">
      {groups.map(({ tool, slots }) => (
        <div
          className={`image-gallery-grid ${slots.length === 1 ? 'is-single' : ''}`}
          key={tool.callId}
        >
          {slots.map(({ index, image }) => (
            <div className={`image-gallery-slot ${image ? 'is-ready' : 'is-pending'}`} key={index}>
              {image ? (
                <ConversationImage asset={image.asset} readImage={readImage} />
              ) : (
                <div
                  className="image-gallery-placeholder"
                  role="status"
                  aria-label={
                    tool.status === 'failed' ||
                    tool.status === 'completed' ||
                    tool.status === 'unknown'
                      ? '图片生成失败'
                      : tool.status === 'cancelled'
                        ? '图片生成已取消'
                        : '正在生成图片'
                  }
                >
                  {tool.status === 'failed' ||
                  tool.status === 'completed' ||
                  tool.status === 'unknown' ? (
                    '生成失败'
                  ) : tool.status === 'cancelled' ? (
                    '已取消'
                  ) : (
                    <WanderingDots seed={`${tool.callId}:${index}`} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {remaining.length ? (
        <div className={`image-gallery-grid ${remaining.length === 1 ? 'is-single' : ''}`}>
          {remaining.map((part) => (
            <div className="image-gallery-slot is-ready" key={part.asset.assetId}>
              <ConversationImage asset={part.asset} readImage={readImage} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
