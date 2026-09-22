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
  onOpenSettings,
  recentTasksError,
  recentTasksLoading,
  onRetryRecentTasks
}: {
  active: 'new' | 'task'
  activeTaskId: string | null
  recentTasks: readonly RecentTaskSummary[]
  onNewTask(): void
  onOpenTask?(taskId: string): void
  onOpenSettings?(): void
  recentTasksError?: string | null
  recentTasksLoading?: boolean
  onRetryRecentTasks?(): void
}) {
  return (
    <aside className="sidebar" data-testid="e2e/shared/sidebar/root#nav" data-width="248">
      <div className="sidebar-window-row">
        <span className="traffic-light-spacer" aria-hidden="true" />
        <IconButton
          className="sidebar-collapse"
          icon="panel-left"
          aria-label="折叠侧栏"
          testId="e2e/shared/sidebar/collapse#button"
        />
      </div>

      <div className="sidebar-brand-row">
        <span className="sidebar-logo-slot">
          <ActionDriverLogo size={18} />
        </span>
        <strong>ActionDriver</strong>
        <IconButton
          className="sidebar-search"
          icon="search"
          aria-label="搜索"
          testId="e2e/shared/sidebar/search#button"
        />
      </div>

      <nav className="sidebar-primary-nav" aria-label="主导航">
        <SidebarEntry
          icon="plus"
          label="新任务"
          onClick={onNewTask}
          selected={active === 'new'}
          testId="e2e/shared/sidebar/new-task#button"
        />
        <SidebarEntry icon="skill" label="Skills" testId="e2e/shared/sidebar/skills#button" />
        <SidebarEntry icon="mcp" label="MCP" testId="e2e/shared/sidebar/mcp#button" />
      </nav>

      <section className="sidebar-recents" aria-labelledby="recent-tasks-title">
        <h2 id="recent-tasks-title">最近任务</h2>
        <div className="recent-task-list">
          {recentTasksLoading ? <p className="sidebar-empty-state">正在加载任务</p> : null}
          {!recentTasksLoading && recentTasksError ? (
            <div className="sidebar-empty-state">
              <span>任务加载失败</span>
              <button type="button" onClick={onRetryRecentTasks}>重试任务</button>
            </div>
          ) : null}
          {!recentTasksLoading && !recentTasksError && recentTasks.length === 0 ? (
            <p className="sidebar-empty-state">暂无任务</p>
          ) : null}
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
