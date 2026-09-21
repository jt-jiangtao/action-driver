import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'

export function TaskHeader({
  title,
  browserCollapsed,
  onExpandBrowser
}: {
  title: string
  browserCollapsed: boolean
  onExpandBrowser(): void
}) {
  return (
    <header className="task-header">
      <AppIcon name="folder" />
      <strong>{title}</strong>
      {browserCollapsed ? (
        <IconButton
          icon="panel-right"
          aria-label="展开浏览器"
          onClick={onExpandBrowser}
          testId="e2e/tasks/detail/browser/expand-collapsed#button"
        />
      ) : null}
    </header>
  )
}
