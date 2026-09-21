import { AppIcon, type AppIconName } from '../ui/AppIcon'

export function SidebarEntry({
  icon,
  label,
  selected = false,
  onClick
}: {
  icon: AppIconName
  label: string
  selected?: boolean
  onClick?(): void
}) {
  return (
    <button
      aria-current={selected ? 'page' : undefined}
      className={`sidebar-nav-item ${selected ? 'is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <AppIcon name={icon} />
      <span>{label}</span>
    </button>
  )
}
