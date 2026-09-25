import type { ModelOptionItemProjection } from '../../models/model-selection'
import { AppIcon } from '../ui/AppIcon'
import { e2eId } from '../../testing/e2e-id'

export function ModelOptionItem({
  active,
  model,
  selected,
  onSelect
}: {
  active: boolean
  model: ModelOptionItemProjection
  selected: boolean
  onSelect(): void
}) {
  return (
    <button
      aria-selected={selected}
      aria-label={model.name}
      className="model-option-item"
      data-active={active}
      data-testid={e2eId('e2e/shared/model-selector/models/:model-id#option', {
        'model-id': model.id
      })}
      onClick={onSelect}
      disabled={model.disabled}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span>{model.name}</span>
      {selected ? <AppIcon name="check" /> : null}
    </button>
  )
}
