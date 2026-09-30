import type { ActivityProjection, TaskTimelineProjectionItem } from '@action-driver/contracts'
import type { StreamServerEvent } from '@action-driver/runtime-contracts'

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

/**
 * Call with one request's events in contiguous request-sequence order; cursor locates replay.
 * The state is immutable: an event copies only the activity, item or map it changes, so every
 * part it leaves alone keeps its reference and renders can skip it.
 */
export function reduceActivityProjection(
  state: ActivityTimelineState,
  event: StreamServerEvent
): ActivityTimelineState {
  if (!('cursor' in event) || event.cursor <= state.cursor) return state
  const next: ActivityTimelineState = { ...state, cursor: event.cursor }
  if (event.type === 'activity.started') {
    if (!next.activities.some((activity) => activity.activityId === event.activityId)) {
      next.activities = [
        ...next.activities,
        {
          activityId: event.activityId,
          title: event.title,
          titleRevision: event.titleRevision,
          status: 'running',
          items: []
        }
      ]
      next.timeline = [
        ...next.timeline,
        { id: `activity:${event.activityId}`, kind: 'activity', activityId: event.activityId }
      ]
    }
    return next
  }
  if (event.type === 'activity.updated') {
    updateActivity(next, event.activityId, (activity) =>
      event.titleRevision > activity.titleRevision
        ? { ...activity, title: event.title, titleRevision: event.titleRevision }
        : activity
    )
    return next
  }
  if (event.type === 'activity.completed') {
    updateActivity(next, event.activityId, (activity) => ({ ...activity, status: 'completed' }))
    return next
  }
  if (event.type === 'activity.text') {
    const textId = event.textId ?? event.eventId
    const itemId = `text:${textId}`
    if (!(textId in next.textPhases)) next.textPhases = { ...next.textPhases, [textId]: 'pending' }
    const appendText = <T extends TaskTimelineProjectionItem>(items: T[]): T[] =>
      items.some((item) => item.id === itemId)
        ? items.map((item) =>
            item.id === itemId && item.kind === 'text'
              ? { ...item, content: item.content + event.delta }
              : item
          )
        : [...items, { id: itemId, kind: 'text', content: event.delta, phase: 'pending' } as T]
    if (next.activities.some((activity) => activity.activityId === event.activityId))
      updateActivity(next, event.activityId, (activity) => ({
        ...activity,
        items: appendText(activity.items)
      }))
    else next.timeline = appendText(next.timeline)
    return next
  }
  if (event.type === 'activity.text.done') {
    next.textPhases = { ...next.textPhases, [event.textId]: event.phase }
    const itemId = `text:${event.textId}`
    const setPhase = <T extends TaskTimelineProjectionItem>(items: T[]): T[] =>
      items.some((item) => item.id === itemId && item.kind === 'text')
        ? items.map((item) =>
            item.id === itemId && item.kind === 'text' ? { ...item, phase: event.phase } : item
          )
        : items
    next.activities = next.activities.map((activity) => {
      const items = setPhase(activity.items)
      return items === activity.items ? activity : { ...activity, items }
    })
    next.timeline = setPhase(next.timeline)
    return next
  }
  if (event.type.startsWith('tool.') && 'callId' in event) {
    const callId = event.callId
    const itemId = `tool:${callId}`
    const activityId = 'activityId' in event ? event.activityId : null
    if (!(callId in next.toolActivityIds))
      next.toolActivityIds = { ...next.toolActivityIds, [callId]: activityId }
    if (activityId) {
      updateActivity(next, activityId, (activity) =>
        activity.items.some((item) => item.id === itemId)
          ? activity
          : { ...activity, items: [...activity.items, { id: itemId, kind: 'tool', callId }] }
      )
    } else if (!next.timeline.some((item) => item.id === itemId)) {
      next.timeline = [...next.timeline, { id: itemId, kind: 'tool', callId }]
    }
  }
  return next
}

/** Replaces one activity; the array is copied only when the activity actually changed. */
function updateActivity(
  state: ActivityTimelineState,
  activityId: string | null,
  update: (activity: ActivityProjection) => ActivityProjection
): void {
  const index = state.activities.findIndex((activity) => activity.activityId === activityId)
  if (index < 0) return
  const current = state.activities[index]!
  const updated = update(current)
  if (updated === current) return
  state.activities = state.activities.map((activity, position) =>
    position === index ? updated : activity
  )
}
