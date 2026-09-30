export interface AgentMessageProjection {
  id: string
  role: 'user' | 'agent'
  content: string
  parts?: MessageContentPart[]
}

export type ImageAssetRef = {
  assetId: string
  sessionId: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteLength: number
  source: 'upload' | 'generated'
}

/**
 * Monotonic position of a block inside the assistant transcript, mirroring the
 * ordinal Codex assigns to every streamed item. A block keeps its order for
 * life: nothing is reordered when the turn finishes.
 */
export type OrderedPart = { order?: number | undefined }

export type MessageContentPart = OrderedPart &
  (
    | { kind: 'text'; text: string }
    /** One tool activity group; anchors it between streamed text and images. */
    | { kind: 'activity'; activityId: string }
    | { kind: 'image-batch'; callId: string; imageCount: number }
    | {
        kind: 'image'
        asset: ImageAssetRef
        generation?: { callId: string; index: number } | undefined
      }
    | { kind: 'document'; file: DocumentFileRef }
  )

/** Metadata of an uploaded document; bytes never travel through messages. */
export type DocumentFileRef = {
  fileId: string
  sessionId: string
  taskId: string
  name: string
  mimeType: string
  byteLength: number
}

export type MessageContent = { text: string } | { parts: MessageContentPart[] }

export function readMessageContentParts(content: MessageContent): MessageContentPart[] {
  return 'parts' in content ? content.parts : [{ kind: 'text', text: content.text }]
}

export function normalizeAssistantParts(
  parts: readonly MessageContentPart[]
): MessageContentPart[] {
  const normalized: MessageContentPart[] = []
  const seenBatches = new Set<string>()
  const seenImages = new Set<string>()
  const seenDocuments = new Set<string>()
  for (const part of sortPartsByOrder(parts)) {
    if (part.kind === 'text') {
      if (!part.text) continue
      const previous = normalized.at(-1)
      if (previous?.kind === 'text') previous.text += part.text
      else normalized.push({ ...part })
      continue
    }
    if (part.kind === 'activity') {
      if (currentActivityId(normalized) === part.activityId) continue
      normalized.push({ ...part })
      continue
    }
    if (part.kind === 'image-batch') {
      if (seenBatches.has(part.callId)) continue
      seenBatches.add(part.callId)
      normalized.push({ ...part })
      continue
    }
    if (part.kind === 'document') {
      if (seenDocuments.has(part.file.fileId)) continue
      seenDocuments.add(part.file.fileId)
      normalized.push({ ...part })
      continue
    }
    const key = part.generation
      ? `${part.generation.callId}:${part.generation.index}`
      : part.asset.assetId
    if (seenImages.has(key)) continue
    seenImages.add(key)
    normalized.push({ ...part })
  }
  return normalized
}

/**
 * Last order a block claims, including the image slots an image batch reserves
 * up front so a batch keeps the position it was created in even when the model
 * keeps streaming text before the images land.
 */
export function partOrder(part: MessageContentPart): number {
  const order = part.order ?? 0
  return part.kind === 'image-batch' ? order + part.imageCount : order
}

/** Next free order for a new block in the transcript. */
export function nextPartOrder(parts: readonly MessageContentPart[]): number {
  let maximum = 0
  for (const part of parts) maximum = Math.max(maximum, partOrder(part))
  return maximum + 1
}

/**
 * Parts in transcript order. Blocks without an order (transcripts stored before
 * the order contract) keep the position they were persisted in.
 */
export function sortPartsByOrder(parts: readonly MessageContentPart[]): MessageContentPart[] {
  if (!parts.some((part) => part.order !== undefined)) return [...parts]
  return parts
    .map((part, index) => ({ part, index }))
    .sort((left, right) => {
      const leftOrder = left.part.order ?? 0
      const rightOrder = right.part.order ?? 0
      return leftOrder - rightOrder || left.index - right.index
    })
    .map((entry) => entry.part)
}

/** Places a block at its order, which is how streamed parts stay ordered. */
export function insertPartByOrder(
  parts: MessageContentPart[],
  part: MessageContentPart
): MessageContentPart[] {
  const order = part.order
  if (order === undefined) {
    parts.push(part)
    return parts
  }
  // Parts stored before the order contract have no order and stay where they
  // are, ahead of everything the stream adds afterwards.
  const index = parts.findIndex((candidate) => (candidate.order ?? 0) > order)
  if (index < 0) parts.push(part)
  else parts.splice(index, 0, part)
  return parts
}

/** The tool group the transcript currently sits in, if any. */
export function currentActivityId(parts: readonly MessageContentPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!
    if (part.kind === 'activity') return part.activityId
  }
  return null
}

/**
 * Anchors a tool group where it starts in the stream. Repeats collapse into the
 * group already in progress, so one call keeps a single anchor no matter how
 * many tool events (proposed, queued, running, completed) arrive for it.
 */
export function appendActivityAnchor(
  parts: MessageContentPart[],
  activityId: string
): MessageContentPart[] {
  if (!activityId || currentActivityId(parts) === activityId) return parts
  insertPartByOrder(parts, { kind: 'activity', activityId, order: nextPartOrder(parts) })
  return parts
}
