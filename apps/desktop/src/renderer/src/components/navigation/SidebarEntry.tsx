import { AppIcon, type AppIconName } from '../ui/AppIcon'

export function SidebarEntry({
  icon,
  label,
  testId,
  selected = false,
  onClick
}: {
  icon: AppIconName
  label: string
  testId: string
  selected?: boolean
  onClick?(): void
}) {
  return (
    <button
      aria-current={selected ? 'page' : undefined}
      className={`sidebar-nav-item ${selected ? 'is-active' : ''}`}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <AppIcon name={icon} />
      <span>{label}</span>
    </button>
  )
}
