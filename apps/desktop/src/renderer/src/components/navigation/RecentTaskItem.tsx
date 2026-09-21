import type { RecentTaskSummary } from '../../models/task-catalog'
import { AppIcon } from '../ui/AppIcon'
import { e2eId } from '../../testing/e2e-id'

export function RecentTaskItem({
  task,
  active,
  onOpen
}: {
  task: RecentTaskSummary
  active: boolean
  onOpen(taskId: string): void
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={`recent-task ${active ? 'is-active' : ''}`}
      data-testid={e2eId('e2e/shared/sidebar/tasks/:task-id#button', { 'task-id': task.id })}
      onClick={() => onOpen(task.id)}
      type="button"
    >
      <span>{task.title}</span>
      {task.state === 'loading' ? (
        <span aria-label="加载中" className="loading-icon">
          <AppIcon name="loader" />
        </span>
      ) : null}
    </button>
  )
}
