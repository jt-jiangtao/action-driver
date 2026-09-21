import type { ModelOption } from '../../models/model-connections'
import { ModelStatusPill } from '../ModelStatusPill'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'

export function ModelPickerRow({
  model,
  onTest,
  onToggle
}: {
  model: ModelOption
  onTest(): void
  onToggle(enabled: boolean): void
}) {
  return (
    <div className="model-picker-row">
      <AppIcon name="cpu" />
      <span className="model-picker-name">{model.name}</span>
      <ModelStatusPill state={model.testState} />
      <IconButton
        aria-label={`测试${model.name}`}
        className="plain-icon-action"
        disabled={model.testState === 'testing'}
        icon="play"
        onClick={onTest}
      />
      <ModelToggle label={`选择${model.name}`} checked={model.enabled} onChange={onToggle} />
    </div>
  )
}
