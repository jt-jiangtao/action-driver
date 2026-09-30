import {
  imageGenerationSlotCount,
  type ActivityProjection,
  type AgentMessageProjection,
  type AppApprovalRequest,
  type PriorActivityTurnProjection,
  type TaskOutputFileProjection,
  type TaskProjection,
  type TaskTimelineProjectionItem,
  type ToolInvocationProjection
} from '@action-driver/contracts'
import {
  activityOwnedText,
  dedupeAssistantText,
  isActivityOwnedText
} from '../components/agent/activity-mirror'

/** One item of the activity area, already decided to be visible there. */
export type ActivityViewItem =
  | { kind: 'text'; id: string; content: string }
  | { kind: 'tool'; id: string; callId: string }
  | { kind: 'activity'; id: string; activityId: string }

/** One finished turn above the current one. */
export type PriorTurnView = {
  key: string
  user: AgentMessageProjection
  replies: AgentMessageProjection[]
  activity: PriorActivityTurnProjection | undefined
}

/** The task fields the activity selection reads; a prior turn passes just these. */
export type ActivitySelectionTask = Pick<TaskProjection, 'status'> & {
  messages?: AgentMessageProjection[] | undefined
  tools?: ToolInvocationProjection[] | undefined
  activities?: ActivityProjection[] | undefined
  activityTimeline?: TaskTimelineProjectionItem[] | undefined
}

/**
 * Everything the task page renders for one task, in order. This is the single
 * decision point for what belongs to the transcript, to the activity area, to a
 * gallery or to an approval card; the components below it only render.
 */
export type TranscriptEntry =
  | { kind: 'turn'; key: string; turn: PriorTurnView }
  | { kind: 'user'; key: string; message: AgentMessageProjection }
  | { kind: 'activity'; key: string; items: ActivityViewItem[] }
  | { kind: 'approval'; key: string; request: AppApprovalRequest }
  | {
      kind: 'assistant'
      key: string
      message: AgentMessageProjection
      tools: ToolInvocationProjection[]
    }
  | { kind: 'output-files'; key: string; files: TaskOutputFileProjection[] }
  | { kind: 'failure'; key: string; detail: string }

const NO_TOOLS: ToolInvocationProjection[] = []
const NO_FILES: TaskOutputFileProjection[] = []
const NO_TURNS: PriorTurnView[] = []
const ASSISTANT_STATUSES: readonly string[] = ['succeeded', 'running', 'paused', 'failed']

/**
 * Finished turns above the current one, memoized on the first message of the
 * task: streaming only replaces the messages of the current turn, so the
 * identity of the first message (and of every historical message) survives a
 * whole stream. That keeps the page's work per tick independent of history.
 */
const priorTurnCache = new WeakMap<
  AgentMessageProjection,
  { currentUserIndex: number; turns: PriorTurnView[] }
>()

export function currentUserIndexIn(messages: readonly AgentMessageProjection[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}

export function selectPriorTurns(task: TaskProjection): PriorTurnView[] {
  const messages = task.messages
  const first = messages[0]
  const currentUserIndex = currentUserIndexIn(messages)
  if (!first || currentUserIndex <= 0) return NO_TURNS
  const cached = priorTurnCache.get(first)
  if (cached && cached.currentUserIndex === currentUserIndex) return cached.turns
  const activityByUser = new Map(
    (task.priorActivityTurns ?? []).map((turn) => [turn.userMessageId, turn])
  )
  const turns: PriorTurnView[] = []
  for (const message of messages.slice(0, currentUserIndex)) {
    if (message.role === 'user') {
      turns.push({
        key: message.id,
        user: message,
        replies: [],
        activity: activityByUser.get(message.id)
      })
      continue
    }
    turns.at(-1)?.replies.push(message)
  }
  priorTurnCache.set(first, { currentUserIndex, turns })
  return turns
}

/** Activity items the activity area owns; everything else stays in the transcript. */
export function selectActivityItems(task: ActivitySelectionTask): ActivityViewItem[] {
  const timeline =
    task.activityTimeline && task.activityTimeline.length > 0
      ? task.activityTimeline
      : (task.tools ?? []).map((tool) => ({
          id: `tool:${tool.callId}`,
          kind: 'tool' as const,
          callId: tool.callId
        }))
  const toolIds = new Set((task.tools ?? []).map((tool) => tool.callId))
  const activityIds = new Set((task.activities ?? []).map((activity) => activity.activityId))
  const items: ActivityViewItem[] = []
  for (const item of timeline) {
    if (item.kind === 'text') {
      if (isActivityOwnedText(item)) {
        items.push({ kind: 'text', id: item.id, content: item.content })
      }
      continue
    }
    if (item.kind === 'tool') {
      if (toolIds.has(item.callId)) items.push({ kind: 'tool', id: item.id, callId: item.callId })
      continue
    }
    if (activityIds.has(item.activityId)) {
      items.push({ kind: 'activity', id: item.id, activityId: item.activityId })
    }
  }
  return items
}

/**
 * Assistant messages of the current turn after de-duplication and visibility
 * filtering. Every transcript is read in the order it was persisted: the
 * activity area owns only the `process` narration, so the mirrored layout for
 * pre-order transcripts is gone and a turn never shows its text twice.
 */
export function selectVisibleAssistantMessages(task: TaskProjection): AgentMessageProjection[] {
  const messages = task.messages
  const currentUserIndex = currentUserIndexIn(messages)
  if (!ASSISTANT_STATUSES.includes(task.status)) return []
  const assistantMessages = messages
    .slice(currentUserIndex + 1)
    .filter((message) => message.role === 'agent')
  if (assistantMessages.length === 0) return []
  const hasImageGallery = (task.tools ?? []).some((tool) => imageGenerationSlotCount(tool) > 0)
  const activityText = activityOwnedText(task)
  const rendered =
    task.status === 'failed'
      ? assistantMessages
          .filter((message) => message.parts?.some((part) => part.kind !== 'text'))
          .map((message) => ({
            ...message,
            content: '',
            parts: message.parts?.filter((part) => part.kind !== 'text') ?? []
          }))
      : assistantMessages.map((message) => dedupeAssistantText(message, activityText))
  // An empty turn renders nothing: the activity area already reports progress,
  // and an empty message would only add spacing or a second status line. Image
  // tools keep theirs, because the gallery placeholders live there.
  return rendered.filter(
    (message, index) =>
      message.content.length > 0 ||
      (message.parts?.length ?? 0) > 0 ||
      (hasImageGallery && index === rendered.length - 1)
  )
}

export function selectTranscript(task: TaskProjection): TranscriptEntry[] {
  const entries: TranscriptEntry[] = selectPriorTurns(task).map((turn) => ({
    kind: 'turn',
    key: `turn-${turn.key}`,
    turn
  }))
  const messages = task.messages
  const currentUserIndex = currentUserIndexIn(messages)
  const currentUser = currentUserIndex < 0 ? undefined : messages[currentUserIndex]
  if (currentUser) entries.push({ kind: 'user', key: currentUser.id, message: currentUser })
  entries.push({
    kind: 'activity',
    key: `activity-${task.id}`,
    items: selectActivityItems(task)
  })
  for (const request of task.pendingAppApproval ?? []) {
    entries.push({ kind: 'approval', key: request.requestId, request })
  }
  for (const message of selectVisibleAssistantMessages(task)) {
    entries.push({ kind: 'assistant', key: message.id, message, tools: task.tools ?? NO_TOOLS })
  }
  entries.push({
    kind: 'output-files',
    key: `files-${task.id}`,
    files: task.outputFiles ?? NO_FILES
  })
  if (task.status === 'failed') {
    entries.push({
      kind: 'failure',
      key: `failure-${task.id}`,
      detail: task.steps.find((step) => step.state === 'failed')?.detail ?? '模型响应失败'
    })
  }
  return entries
}
