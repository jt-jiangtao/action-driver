import type { ActivityProjection, TaskTimelineProjectionItem } from '@actiondriver/contracts'
import type { StreamServerEvent } from './stream-protocol'

export type ActivityTimelineState = {
  cursor: number
  activities: ActivityProjection[]
  timeline: TaskTimelineProjectionItem[]
  toolActivityIds: Record<string, string | null>
  textPhases: Record<string, 'pending' | 'process' | 'final'>
}

export function emptyActivityTimelineState(cursor = 0): ActivityTimelineState {
  return { cursor, activities: [], timeline: [], toolActivityIds: {}, textPhases: {} }
}

/** The persisted cursor is the sole ordering authority for display positions. */
export function reduceActivityProjection(
  state: ActivityTimelineState,
  event: StreamServerEvent
): ActivityTimelineState {
  if (!('cursor' in event) || event.cursor <= state.cursor) return state
  const next: ActivityTimelineState = {
    cursor: event.cursor,
    activities: state.activities.map((activity) => ({
      ...activity,
      items: activity.items.map((item) => ({ ...item }))
    })),
    timeline: state.timeline.map((item) => ({ ...item })),
    toolActivityIds: { ...state.toolActivityIds },
    textPhases: { ...state.textPhases }
  }
  if (event.type === 'activity.started') {
    if (!next.activities.some((activity) => activity.activityId === event.activityId)) {
      next.activities.push({
        activityId: event.activityId,
        title: event.title,
        titleRevision: event.titleRevision,
        status: 'running',
        items: []
      })
      next.timeline.push({
        id: `activity:${event.activityId}`,
        kind: 'activity',
        activityId: event.activityId
      })
    }
    return next
  }
  if (event.type === 'activity.updated') {
    const activity = next.activities.find((entry) => entry.activityId === event.activityId)
    if (activity && event.titleRevision > activity.titleRevision) {
      activity.title = event.title
      activity.titleRevision = event.titleRevision
    }
    return next
  }
  if (event.type === 'activity.completed') {
    const activity = next.activities.find((entry) => entry.activityId === event.activityId)
    if (activity) activity.status = 'completed'
    return next
  }
  if (event.type === 'activity.text') {
    const textId = event.textId ?? event.eventId
    const itemId = `text:${textId}`
    next.textPhases[textId] ??= 'pending'
    const activity = next.activities.find((entry) => entry.activityId === event.activityId)
    const items = activity?.items ?? next.timeline
    const existing = items.find((item) => item.id === itemId)
    if (existing?.kind === 'text') existing.content += event.delta
    else items.push({ id: itemId, kind: 'text', content: event.delta, phase: 'pending' })
    return next
  }
  if (event.type === 'activity.text.done') {
    next.textPhases[event.textId] = event.phase
    const itemId = `text:${event.textId}`
    for (const activity of next.activities) {
      const item = activity.items.find((entry) => entry.id === itemId)
      if (item?.kind === 'text') item.phase = event.phase
    }
    const topLevel = next.timeline.find((entry) => entry.id === itemId)
    if (topLevel?.kind === 'text') topLevel.phase = event.phase
    return next
  }
  if (event.type.startsWith('tool.') && 'callId' in event) {
    const callId = event.callId
    const itemId = `tool:${callId}`
    const activityId = 'activityId' in event ? event.activityId : null
    if (!(callId in next.toolActivityIds)) next.toolActivityIds[callId] = activityId
    if (activityId) {
      const activity = next.activities.find((entry) => entry.activityId === activityId)
      if (activity && !activity.items.some((item) => item.id === itemId)) {
        activity.items.push({ id: itemId, kind: 'tool', callId })
      }
    } else if (!next.timeline.some((item) => item.id === itemId)) {
      next.timeline.push({ id: itemId, kind: 'tool', callId })
    }
  }
  return next
}
