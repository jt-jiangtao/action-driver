import { canonicalToolId } from '@actiondriver/plugin-contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TaskProjection } from '@actiondriver/contracts'
import { MarkdownContent } from './MarkdownContent'
import { ActivityGroup, ToolRow } from './agent/ToolGroup'
import type { ImageReader } from './agent/ConversationImage'
import { isActivityOwnedText } from './agent/activity-mirror'

/** The task fields the activity area reads; a prior turn passes just these. */
export type ActivityTimelineTask = Pick<
  TaskProjection,
  | 'id'
  | 'status'
  | 'messages'
  | 'tools'
  | 'activities'
  | 'activityTimeline'
  | 'activityStartedAt'
  | 'activityDurationMs'
  | 'preparingToolName'
>

export function ActivityTimeline({ task, readImage }: { task: ActivityTimelineTask; readImage?: ImageReader | undefined }) {
  // Keyed by reference so memoized groups and rows skip renders while text streams elsewhere.
  const activities = useMemo(
    () => new Map((task.activities ?? []).map((activity) => [activity.activityId, activity])),
    [task.activities]
  )
  const tools = useMemo(
    () => new Map((task.tools ?? []).map((tool) => [tool.callId, tool])),
    [task.tools]
  )
  const timeline =
    task.activityTimeline && task.activityTimeline.length > 0
      ? task.activityTimeline
      : (task.tools ?? []).map((tool) => ({
          id: `tool:${tool.callId}`,
          kind: 'tool' as const,
          callId: tool.callId
        }))
  // The activity area owns the process narration the runtime closed before its
  // tool groups; the answer and pending text stay in the transcript.
  const items = timeline
  const hasVisibleContent = items.some((item) =>
    item.kind === 'text'
      ? isActivityOwnedText(task, item)
      : item.kind === 'tool'
        ? tools.has(item.callId)
        : activities.has(item.activityId)
  )
  const latestItem = timeline.at(-1)
  const hasPendingText = latestItem?.kind === 'text' && latestItem.phase === 'pending'
  const hasActiveTool = [...tools.values()].some((tool) =>
    ['proposed', 'queued', 'running', 'waiting_approval'].includes(tool.status)
  )
  // Only while the model is planning *without* any text on screen: streaming
  // prose already shows progress, and a group that is still running must not
  // flash the indicator on and off.
  const streamingText = latestItem?.kind === 'text' && latestItem.content.length > 0
  // Image placeholders already show progress; the indicator would sit between
  // the tool group and the images.
  const imageInFlight = (task.tools ?? []).some(
    (tool) =>
      canonicalToolId(tool.toolId) === 'tools.local.image-generation.generate' &&
      ['proposed', 'queued', 'running', 'waiting_approval'].includes(tool.status)
  )
  const showThinking =
    task.status === 'running' &&
    !hasActiveTool &&
    !imageInFlight &&
    !streamingText &&
    (!hasVisibleContent || hasPendingText || !!task.preparingToolName)
  const fallbackStartedAt = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (task.status !== 'running') return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [task.status, task.id, task.activityStartedAt])

  const startedAt = task.activityStartedAt
    ? Date.parse(task.activityStartedAt)
    : fallbackStartedAt.current
  const elapsedMs = Math.max(
    0,
    now - (Number.isFinite(startedAt) ? startedAt : fallbackStartedAt.current)
  )
  const body = (
    <div className="activity-timeline-items">
      {items.map((item) => {
        if (item.kind === 'text') {
          if (!isActivityOwnedText(task, item)) return null
          return (
            <MarkdownContent
              key={item.id}
              className="activity-process-text markdown-content"
              content={item.content}
            />
          )
        }
        if (item.kind === 'tool') return <ToolRow key={item.id} tool={tools.get(item.callId)} readImage={readImage} />
        const activity = activities.get(item.activityId)
        if (!activity) return null
        return <ActivityGroup key={item.id} activity={activity} tools={tools} readImage={readImage} />
      })}
    </div>
  )

  return (
    <section
      className={`activity-timeline${showThinking && !hasVisibleContent ? ' is-initial-thinking' : ''}`}
      aria-label="任务过程"
    >
      {task.status === 'running' ? (
        <>
          <div className="activity-elapsed" aria-label="已处理时间">
            已处理 {formatRunningDuration(elapsedMs)}
          </div>
          {hasVisibleContent ? body : null}
          {showThinking ? (
            <div className="activity-thinking activity-active-title" role="status">
              正在思考
            </div>
          ) : null}
        </>
      ) : hasVisibleContent ? (
        <details className="activity-archive">
          <summary data-testid="e2e/tasks/detail/activity/archive#button">
            <span>用时 {formatDuration(task.activityDurationMs)}</span>
            <ChevronRight aria-hidden="true" className="activity-chevron" size={16} />
          </summary>
          {body}
        </details>
      ) : (
        <div className="activity-elapsed">用时 {formatDuration(task.activityDurationMs)}</div>
      )}
    </section>
  )
}

/** Running elapsed time: whole seconds only, never below one. */
function formatRunningDuration(value: number): string {
  const seconds = Math.max(1, Math.round(value / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

/** Archived duration: whole seconds, never below one, minutes only when needed. */
function formatDuration(value?: number): string {
  if (value === undefined) return '—'
  const seconds = Math.max(1, Math.round(value / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
