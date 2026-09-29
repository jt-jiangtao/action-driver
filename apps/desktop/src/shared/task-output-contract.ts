export const TASK_OUTPUT_OPEN_CHANNEL = 'desktop:task-output:open'

/**
 * Opening a deliverable. `uri` is the unified resource reference; the legacy `fileId` triple keeps
 * working so existing task cards do not need a migration. Exactly one of the two is required.
 */
export type TaskOutputOpenRequest = {
  uri?: string
  fileId?: string
  taskId: string
  sessionId: string
}
