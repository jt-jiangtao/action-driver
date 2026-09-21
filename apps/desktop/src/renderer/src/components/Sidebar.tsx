import { ActionDriverLogo } from './ActionDriverLogo'
import type { RecentTaskSummary } from '../models/task-catalog'
import { IconButton } from './ui/IconButton'
import { RecentTaskItem } from './navigation/RecentTaskItem'
import { SettingsNavEntry } from './navigation/SettingsNavEntry'
import { SidebarEntry } from './navigation/SidebarEntry'

export function Sidebar({
  active,
  activeTaskId,
  recentTasks,
  onNewTask,
  onOpenTask,
  onOpenSettings
}: {
  active: 'new' | 'task'
  activeTaskId: string | null
  recentTasks: readonly RecentTaskSummary[]
  onNewTask(): void
  onOpenTask?(taskId: string): void
  onOpenSettings?(): void
}) {
  return (
    <aside className="sidebar" data-testid="sidebar" data-width="248">
      <div className="sidebar-window-row">
        <span className="traffic-light-spacer" aria-hidden="true" />
        <IconButton className="sidebar-collapse" icon="panel-left" aria-label="折叠侧栏" />
      </div>

      <div className="sidebar-brand-row">
        <span className="sidebar-logo-slot">
          <ActionDriverLogo size={18} />
        </span>
        <strong>ActionDriver</strong>
        <IconButton className="sidebar-search" icon="search" aria-label="搜索" />
      </div>

      <nav className="sidebar-primary-nav" aria-label="主导航">
        <SidebarEntry icon="plus" label="新任务" onClick={onNewTask} selected={active === 'new'} />
        <SidebarEntry icon="skill" label="Skills" />
        <SidebarEntry icon="mcp" label="MCP" />
      </nav>

      <section className="sidebar-recents" aria-labelledby="recent-tasks-title">
        <h2 id="recent-tasks-title">最近任务</h2>
        <div className="recent-task-list">
          {recentTasks.map((task) => (
            <RecentTaskItem
              active={active === 'task' && activeTaskId === task.id}
              key={task.id}
              onOpen={(taskId) => onOpenTask?.(taskId)}
              task={task}
            />
          ))}
        </div>
      </section>
      <div className="sidebar-footer">
        <SettingsNavEntry {...(onOpenSettings ? { onClick: onOpenSettings } : {})} />
      </div>
    </aside>
  )
}
