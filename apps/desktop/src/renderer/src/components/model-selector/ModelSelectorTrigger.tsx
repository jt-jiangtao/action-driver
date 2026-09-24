import type { KeyboardEvent } from 'react'
import { AppIcon } from '../ui/AppIcon'

export function ModelSelectorTrigger({
  connectionName,
  modelName,
  selected,
  open,
  controls,
  onClick,
  onKeyDown,
  disabled
}: {
  connectionName: string
  modelName: string
  selected: boolean
  open: boolean
  controls: string
  onClick(): void
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void
  disabled?: boolean
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={modelName ? `当前模型：${connectionName} / ${modelName}` : connectionName}
      className="model-selector-trigger"
      disabled={disabled}
      data-state={open ? 'open' : 'default'}
      data-selected={selected}
      data-testid="e2e/shared/model-selector/trigger#button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      type="button"
    >
      <AppIcon name="cpu" />
      <span>{modelName ? `${connectionName} / ${modelName}` : connectionName}</span>
      <AppIcon name="chevron-down" />
    </button>
  )
}
