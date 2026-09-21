import type { ModelOption } from '../../models/model-connections'
import { ModelStatusPill } from '../ModelStatusPill'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { e2eId } from '../../testing/e2e-id'

export function ManualModelRow({
  model,
  onChangeName,
  onTest,
  onToggle
}: {
  model: ModelOption
  onChangeName(name: string): void
  onTest(): void
  onToggle(enabled: boolean): void
}) {
  return (
    <div className="model-picker-row manual-model-row">
      <AppIcon name="cpu" />
      <input
        aria-label="手动模型名称"
        data-testid={e2eId('e2e/settings/add-model-set/models/:model-id/name#input', {
          'model-id': model.id
        })}
        value={model.name}
        onChange={(event) => onChangeName(event.currentTarget.value)}
      />
      <ModelStatusPill state={model.testState} />
      <IconButton
        aria-label={`测试${model.name}`}
        icon="play"
        onClick={onTest}
        testId={e2eId('e2e/settings/add-model-set/models/:model-id/test#button', {
          'model-id': model.id
        })}
      />
      <ModelToggle
        label={`选择${model.name}`}
        checked={model.enabled}
        onChange={onToggle}
        testId={e2eId('e2e/settings/add-model-set/models/:model-id/toggle#switch', {
          'model-id': model.id
        })}
      />
    </div>
  )
}
