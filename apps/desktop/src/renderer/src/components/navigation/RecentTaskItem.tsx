import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { RecentTaskSummary } from '../../models/task-catalog'
import { AppIcon } from '../ui/AppIcon'
import { e2eId } from '../../testing/e2e-id'

export function RecentTaskItem({
  task,
  active,
  onOpen,
  onArchive,
  busy = false
}: {
  task: RecentTaskSummary
  active: boolean
  onOpen(taskId: string): void
  onArchive?(sessionId: string): void
  busy?: boolean
}) {
  const titleViewport = useRef<HTMLSpanElement>(null)
  const titleText = useRef<HTMLSpanElement>(null)
  const [interacting, setInteracting] = useState(false)
  const [overflow, setOverflow] = useState(0)
  useEffect(() => {
    if (!interacting) {
      setOverflow(0)
      return
    }
    const measure = () =>
      setOverflow(
        Math.max(
          0,
          (titleText.current?.scrollWidth ?? 0) - (titleViewport.current?.clientWidth ?? 0)
        )
      )
    const frame = requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (titleViewport.current) observer?.observe(titleViewport.current)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [interacting, task.title])
  return (
    <div
      className={`recent-task ${active ? 'is-active' : ''}`}
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocus={() => setInteracting(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false)
      }}
      data-interacting={interacting || undefined}
    >
      <button
        aria-current={active ? 'page' : undefined}
        className="recent-task-open"
        data-testid={e2eId('e2e/shared/sidebar/tasks/:task-id#button', { 'task-id': task.id })}
        onClick={() => onOpen(task.id)}
        title={task.title}
        type="button"
      >
        <span className="recent-task-title-viewport" ref={titleViewport}>
          <span
            className="recent-task-title"
            ref={titleText}
            style={{ '--title-overflow': `${overflow}px` } as CSSProperties}
          >
            {task.title}
          </span>
        </span>
      </button>
      <span className="recent-task-actions">
        {task.state === 'loading' ? (
          <span aria-label="加载中" className="loading-icon">
            <AppIcon name="loader" />
          </span>
        ) : null}
        {task.sessionId && onArchive ? (
          <button
            type="button"
            className="recent-task-action"
            aria-label="归档"
            title={task.state === 'loading' ? '进行中的聊天无法归档' : '归档'}
            data-testid={e2eId('e2e/shared/sidebar/tasks/:task-id/archive#button', {
              'task-id': task.id
            })}
            disabled={busy || task.state === 'loading'}
            onClick={() => onArchive(task.sessionId!)}
          >
            <AppIcon name="archive" size={15} />
          </button>
        ) : null}
      </span>
    </div>
  )
}
