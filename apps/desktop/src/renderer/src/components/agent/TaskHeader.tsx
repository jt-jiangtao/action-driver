import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { AppNavigationControls } from '../navigation/AppNavigationControls'

export function TaskHeader({
  title,
  sidebarCollapsed = false,
  onExpandSidebar,
  browserCollapsed,
  onExpandBrowser
}: {
  title: string
  sidebarCollapsed?: boolean
  onExpandSidebar?: (() => void) | undefined
  browserCollapsed: boolean
  onExpandBrowser(): void
}) {
  return (
    <header className={`task-header${sidebarCollapsed ? ' has-sidebar-restore' : ''}`}>
      {sidebarCollapsed && onExpandSidebar ? (
        <AppNavigationControls sidebar={{ collapsed: true, onToggle: onExpandSidebar }} />
      ) : null}
      <AppIcon name="folder" />
      <strong>{title}</strong>
      {browserCollapsed ? (
        <IconButton
          className="task-browser-expand"
          icon="panel-right"
          aria-label="展开浏览器"
          onClick={onExpandBrowser}
          testId="e2e/tasks/detail/browser/expand-collapsed#button"
        />
      ) : null}
    </header>
  )
}
