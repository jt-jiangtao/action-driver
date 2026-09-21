import type { ModelOption } from '../../models/model-connections'
import { ModelStatusPill } from '../ModelStatusPill'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { e2eId } from '../../testing/e2e-id'

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
          testId={e2eId('e2e/settings/model-connections/models/:model-id/test#button', {
            'model-id': model.id
          })}
          onClick={onTest}
        />
      </span>
      <ModelToggle
        label={`启用${model.name}`}
        checked={model.enabled}
        onChange={onToggle}
        testId={e2eId('e2e/settings/model-connections/models/:model-id/toggle#switch', {
          'model-id': model.id
        })}
      />
    </div>
  )
}
