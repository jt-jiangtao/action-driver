import { AppIcon } from '../ui/AppIcon'
import { e2eId } from '../../testing/e2e-id'

export function ModelConnectionItem({
  expanded,
  connectionId,
  name,
  onToggle
}: {
  expanded: boolean
  connectionId: string
  name: string
  onToggle(): void
}) {
  return (
    <button
      aria-expanded={expanded}
      className="model-connection-item"
      data-testid={e2eId('e2e/shared/model-selector/connections/:connection-id#button', {
        'connection-id': connectionId
      })}
      onClick={onToggle}
      type="button"
    >
      <AppIcon name="server" />
      <span>{name}</span>
      <AppIcon name={expanded ? 'chevron-down' : 'chevron-right'} />
    </button>
  )
}
