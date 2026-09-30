import {
  hasImageGenerationGallery,
  IMAGE_GENERATION_TOOL_ID,
  type AgentMessageProjection,
  type MessageContentPart,
  type ToolInvocationProjection
} from '@action-driver/contracts'

type ImagePart = Extract<MessageContentPart, { kind: 'image' }>

/**
 * One rendered piece of an assistant message, already ordered: text blocks keep
 * the position the runtime assigned, and every image batch owns exactly one
 * gallery at the place its call ran.
 */
export type MediaBlock =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'gallery'; key: string; images: ImagePart[]; tools: ToolInvocationProjection[] }

export type MessageMediaPlan = {
  /** False when the message renders as one plain markdown node. */
  hasMedia: boolean
  blocks: MediaBlock[]
}

/**
 * The only place that decides what an assistant message shows: galleries anchor
 * on their `image-batch` part, images without an anchor keep their own position,
 * and in-flight batches render their placeholders. Pure so it can be tested
 * without rendering the page.
 */
export function planMessageMedia(
  message: AgentMessageProjection,
  tools: readonly ToolInvocationProjection[]
): MessageMediaPlan {
  const parts = message.parts
  const activeTools = tools.filter((tool) => hasImageGenerationGallery(tool))
  const images = parts?.filter((part): part is ImagePart => part.kind === 'image') ?? []
  const hasBatches = parts?.some((part) => part.kind === 'image-batch') ?? false
  const hasMedia = images.length > 0 || activeTools.length > 0 || hasBatches
  if (!hasMedia) {
    return {
      hasMedia: false,
      blocks: message.content ? [{ kind: 'text', key: 'message', text: message.content }] : []
    }
  }
  if (!parts?.length) {
    return {
      hasMedia: true,
      blocks: [
        ...(message.content
          ? [{ kind: 'text' as const, key: 'message', text: message.content }]
          : []),
        { kind: 'gallery', key: 'gallery', images, tools: activeTools }
      ]
    }
  }

  const anchoredCalls = new Set(
    parts.filter((part) => part.kind === 'image-batch').map((part) => part.callId)
  )
  const shownCalls = new Set<string>()
  const blocks: MediaBlock[] = []
  parts.forEach((part, index) => {
    if (part.kind === 'text') {
      if (part.text) blocks.push({ kind: 'text', key: `text-${index}`, text: part.text })
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
        callId: part.callId,
        toolId: IMAGE_GENERATION_TOOL_ID,
        modelName: 'tools_local_image_generation_generate',
        summary: '生成图片',
        argumentsHash: '',
        imageCount: part.imageCount,
        status: 'completed' as const
      }
      blocks.push({
        kind: 'gallery',
        key: `batch-${part.callId}`,
        images: images.filter((image) => image.generation?.callId === part.callId),
        tools: [{ ...tool, imageCount: part.imageCount }]
      })
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
    blocks.push({ kind: 'gallery', key: `image-${index}`, images: [part], tools: [] })
  })
  const pendingTools = activeTools.filter(
    (tool) => !shownCalls.has(tool.callId) && !anchoredCalls.has(tool.callId)
  )
  if (pendingTools.length) {
    blocks.push({ kind: 'gallery', key: 'pending-batches', images: [], tools: pendingTools })
  }
  return { hasMedia: true, blocks }
}
