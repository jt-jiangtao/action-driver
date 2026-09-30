import { ProductLogo } from './ProductLogo'
import type { RecentTaskSummary } from '../models/task-catalog'
import { RecentTaskItem } from './navigation/RecentTaskItem'
import { SettingsNavEntry } from './navigation/SettingsNavEntry'
import { SidebarEntry } from './navigation/SidebarEntry'
import { PluginContributionsMenu } from './plugins/PluginContributionsMenu'
import { AppNavigationControls } from './navigation/AppNavigationControls'

export function Sidebar({
  active,
  activeTaskId,
  recentTasks,
  onCollapse,
  onNewTask,
  onOpenTask,
  onOpenSettings,
  recentTasksError,
  recentTasksLoading,
  onRetryRecentTasks,
  onArchiveTask,
  busySessionId,
  actionError
}: {
  active: 'new' | 'task'
  activeTaskId: string | null
  recentTasks: readonly RecentTaskSummary[]
  onCollapse(): void
  onNewTask(): void
  onOpenTask?(taskId: string): void
  onOpenSettings?(): void
  recentTasksError?: string | null
  recentTasksLoading?: boolean
  onRetryRecentTasks?(): void
  onArchiveTask?(sessionId: string): void
  busySessionId?: string | null
  actionError?: string | null
}) {
  return (
    <aside className="sidebar" data-testid="e2e/shared/sidebar/root#nav" data-width="236">
      <div className="sidebar-window-row">
        <AppNavigationControls sidebar={{ collapsed: false, onToggle: onCollapse }} />
      </div>

      <div className="sidebar-brand-row">
        <span className="sidebar-logo-slot">
          <ProductLogo size={18} />
        </span>
        <strong>Action-Driver</strong>
      </div>

      <nav className="sidebar-primary-nav" aria-label="主导航">
        <SidebarEntry
          icon="new-chat"
          label="新任务"
          onClick={onNewTask}
          selected={active === 'new'}
          testId="e2e/shared/sidebar/new-task#button"
        />
        <SidebarEntry icon="skill" label="Skills" testId="e2e/shared/sidebar/skills#button" />
        <SidebarEntry icon="mcp" label="MCP" testId="e2e/shared/sidebar/mcp#button" />
        <PluginContributionsMenu {...(activeTaskId ? { taskId: activeTaskId } : {})} />
      </nav>

      <section className="sidebar-recents" aria-labelledby="recent-tasks-title">
        <h2 id="recent-tasks-title">最近任务</h2>
        <div className="recent-task-list">
          {actionError ? (
            <p className="sidebar-empty-state" role="alert">
              {actionError}
            </p>
          ) : null}
          {recentTasksLoading ? <p className="sidebar-empty-state">正在加载任务</p> : null}
          {!recentTasksLoading && recentTasksError ? (
            <div className="sidebar-empty-state">
              <span>任务加载失败</span>
              <button
                type="button"
                data-testid="e2e/shared/sidebar/retry-tasks#button"
                onClick={onRetryRecentTasks}
              >
                重试任务
              </button>
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
              {...(onArchiveTask ? { onArchive: onArchiveTask } : {})}
              busy={busySessionId === task.sessionId}
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
