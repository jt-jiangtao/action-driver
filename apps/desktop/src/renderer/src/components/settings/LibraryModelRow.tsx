import type { ModelOption } from '../../models/model-connections'
import { ModelStatusPill } from '../ModelStatusPill'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'

export function LibraryModelRow({
  model,
  onTest,
  onToggle
}: {
  model: ModelOption
  onTest(): void
  onToggle(enabled: boolean): void
}) {
  return (
    <div className="model-row">
      <span className="model-name-cell"><AppIcon name="cpu" />{model.name}</span>
      <span className="model-state-cell">
        <ModelStatusPill state={model.testState} />
        <IconButton
          aria-label={`测试${model.name}`}
          className="plain-icon-action model-test-action"
          disabled={model.testState === 'testing'}
          icon="play"
          onClick={onTest}
        />
      </span>
      <ModelToggle label={`启用${model.name}`} checked={model.enabled} onChange={onToggle} />
    </div>
  )
}
