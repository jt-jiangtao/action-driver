import type {
  AgentMessageProjection,
  MessageContentPart,
  SkillExecutionState,
  TaskTimelineProjectionItem
} from '@action-driver/contracts'

type ActivityTask = {
  status: SkillExecutionState
  activityTimeline?: TaskTimelineProjectionItem[] | undefined
  messages?: AgentMessageProjection[] | undefined
}

/** Tool groups the runtime anchored inside the transcript. */
export function anchoredActivityIds(
  messages: readonly AgentMessageProjection[] | undefined
): Set<string> {
  const ids = new Set<string>()
  for (const message of messages ?? [])
    for (const part of message.parts ?? [])
      if (part.kind === 'activity') ids.add(part.activityId)
  return ids
}

/**
 * Text the activity area owns. The runtime closes each streamed block with a
 * phase: blocks that ended a turn which went on to call tools are `process`
 * narration and belong to the activity area, while the block that ended the
 * task is `final` and stays in the transcript as the answer. Pending blocks are
 * still the answer-to-be, so they render in the transcript and never jump.
 */
export function isActivityOwnedText(
  item: TaskTimelineProjectionItem
): item is Extract<TaskTimelineProjectionItem, { kind: 'text' }> {
  return item.kind === 'text' && item.content.length > 0 && item.phase === 'process'
}

/** Text the activity area owns; the assistant message must not repeat it. */
export function activityOwnedText(task: ActivityTask): string {
  return (task.activityTimeline ?? [])
    .filter((item) => isActivityOwnedText(item))
    .map((item) => item.content)
    .join('')
}

/**
 * Drops the activity-owned narration from an assistant message, leaving the
 * answer and the images in the order the runtime assigned. The two channels
 * stream independently and lead or trail each other by a delta, so only a
 * shared prefix is removed: comparing for equality would make the message text
 * flash in and out on every event.
 */
export function dedupeAssistantText(
  message: AgentMessageProjection,
  activityText: string
): AgentMessageProjection {
  if (!activityText) return message
  const streamed = message.parts
    ? message.parts.filter((part) => part.kind === 'text').map((part) => part.text).join('')
    : message.content
  if (!streamed) return message
  const shared = sharedPrefixLength(streamed, activityText)
  if (shared === 0 || shared !== Math.min(streamed.length, activityText.length)) return message
  if (!message.parts) return { ...message, content: message.content.slice(shared) }
  const parts = dropTextPrefix(message.parts, shared)
  return {
    ...message,
    content: parts
      .filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join(''),
    parts
  }
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function dropTextPrefix(parts: MessageContentPart[], length: number): MessageContentPart[] {
  const remaining = { count: length }
  const stripped: MessageContentPart[] = []
  for (const part of parts) {
    if (part.kind !== 'text' || remaining.count <= 0) {
      stripped.push(part)
      continue
    }
    if (part.text.length <= remaining.count) {
      remaining.count -= part.text.length
      continue
    }
    stripped.push({ ...part, text: part.text.slice(remaining.count) })
    remaining.count = 0
  }
  return stripped
}
