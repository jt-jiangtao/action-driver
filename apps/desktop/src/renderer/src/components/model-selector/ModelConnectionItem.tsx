import { AppIcon } from '../ui/AppIcon'

export function ModelConnectionItem({
  expanded,
  name,
  onToggle
}: {
  expanded: boolean
  name: string
  onToggle(): void
}) {
  return (
    <button
      aria-expanded={expanded}
      className="model-connection-item"
      onClick={onToggle}
      type="button"
    >
      <AppIcon name="server" />
      <span>{name}</span>
      <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} />
    </button>
  )
}
