import type { KeyboardEvent } from 'react'
import { AppIcon } from '../ui/AppIcon'

export function ModelSelectorTrigger({
  connectionName,
  modelName,
  open,
  controls,
  onClick,
  onKeyDown
}: {
  connectionName: string
  modelName: string
  open: boolean
  controls: string
  onClick(): void
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={`当前模型：${connectionName} / ${modelName}`}
      className="model-selector-trigger"
      data-state={open ? 'open' : 'default'}
      onClick={onClick}
      onKeyDown={onKeyDown}
      type="button"
    >
      <AppIcon name="cpu" />
      <span>{connectionName} / {modelName}</span>
      <AppIcon name="chevron-down" />
    </button>
  )
}
