import { useMemo } from 'react'
import type { TaskProjection } from '@action-driver/contracts'
import { selectTranscript, type TranscriptEntry } from './transcript'

/**
 * The task page's only derived view. It re-runs when the task reference
 * changes — that is once per streaming tick — but the per-turn work stays
 * independent of history length because finished turns are served from the
 * selector's identity cache.
 */
export function useTaskView(task: TaskProjection): TranscriptEntry[] {
  return useMemo(() => selectTranscript(task), [task])
}
