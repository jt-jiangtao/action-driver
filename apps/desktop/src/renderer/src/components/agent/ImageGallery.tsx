import { canonicalToolId } from '@actiondriver/plugin-contracts'
import { useMemo, type ReactNode } from 'react'
import type { MessageContentPart, ToolInvocationProjection } from '@actiondriver/contracts'
import { ConversationImage, useImagePreview, type ImageReader } from './ConversationImage'
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
      canonicalToolId(tool.toolId) === 'tools.local.image-generation.generate' &&
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
  // Images without a matching tool row (or anchor) still follow the slot order
  // the generator reserved, never the order they finished in.
  const remaining = images
    .filter((part) => !grouped.has(part))
    .map((part, order) => ({ part, order }))
    .sort((a, b) => {
      const aCall = a.part.generation?.callId ?? ''
      const bCall = b.part.generation?.callId ?? ''
      if (aCall !== bCall) return a.order - b.order
      return (a.part.generation?.index ?? a.order) - (b.part.generation?.index ?? b.order)
    })
    .map((entry) => entry.part)
  if (!groups.length && !remaining.length) return null
  return (
    <div className="image-gallery">
      {groups.map(({ tool, slots }) => (
        <ImageGrid
          key={tool.callId}
          slots={slots.map(({ index, image }) => ({
            key: String(index),
            image,
            placeholder: <PendingImage tool={tool} index={index} />
          }))}
          readImage={readImage}
        />
      ))}
      {remaining.length ? (
        <ImageGrid
          slots={remaining.map((part) => ({ key: part.asset.assetId, image: part }))}
          readImage={readImage}
        />
      ) : null}
    </div>
  )
}

/** One grid is one preview group: its images switch among themselves and nowhere else. */
function ImageGrid({
  slots,
  readImage
}: {
  slots: Array<{ key: string; image?: ImagePart | undefined; placeholder?: ReactNode }>
  readImage?: ImageReader | undefined
}) {
  // Slots are rebuilt on every render; the asset ids alone decide the group.
  const groupKey = slots.map((slot) => slot.image?.asset.assetId ?? '').join('|')
  const assets = useMemo(
    () => slots.flatMap((slot) => (slot.image ? [slot.image.asset] : [])),
    [groupKey]
  )
  const { open, reportUrl, preview } = useImagePreview(assets)
  return (
    <div className={`image-gallery-grid ${slots.length === 1 ? 'is-single' : ''}`}>
      {slots.map(({ key, image, placeholder }) => (
        <div className={`image-gallery-slot ${image ? 'is-ready' : 'is-pending'}`} key={key}>
          {image ? (
            <ConversationImage
              asset={image.asset}
              readImage={readImage}
              onOpen={open}
              onUrlChange={reportUrl}
            />
          ) : (
            placeholder
          )}
        </div>
      ))}
      {preview}
    </div>
  )
}

function PendingImage({ tool, index }: { tool: ToolInvocationProjection; index: number }) {
  const ended = tool.status === 'failed' || tool.status === 'completed' || tool.status === 'unknown'
  return (
    <div
      className="image-gallery-placeholder"
      role="status"
      aria-label={ended ? '图片生成失败' : tool.status === 'cancelled' ? '图片生成已取消' : '正在生成图片'}
    >
      {ended ? (
        '生成失败'
      ) : tool.status === 'cancelled' ? (
        '已取消'
      ) : (
        <WanderingDots seed={`${tool.callId}:${index}`} />
      )}
    </div>
  )
}
