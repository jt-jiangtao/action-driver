import type { ModelOptionItemProjection } from '../../models/model-selection'
import { AppIcon } from '../ui/AppIcon'

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
      className="model-option-item"
      data-active={active}
      onClick={onSelect}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span>{model.name}</span>
      {selected ? <AppIcon name="check" /> : null}
    </button>
  )
}
