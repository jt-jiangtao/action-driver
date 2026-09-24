import { IconButton } from '../ui/IconButton'

export function SidebarRestoreButton({ onClick }: { onClick(): void }) {
  return (
    <IconButton
      className="sidebar-restore-button"
      icon="panel-left"
      aria-label="展开侧栏"
      onClick={onClick}
      testId="e2e/shared/sidebar/restore#button"
    />
  )
}
