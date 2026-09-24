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
  onToggle,
  allowTest = true
}: {
  model: ModelOption
  onChangeName(name: string): void
  onTest(): void
  onToggle(enabled: boolean): void
  allowTest?: boolean
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
      {allowTest ? <ModelStatusPill state={model.testState} /> : <span>生图专用</span>}
      {allowTest ? (
        <IconButton
          aria-label={`测试${model.name}`}
          icon="play"
          onClick={onTest}
          testId={e2eId('e2e/settings/add-model-set/models/:model-id/test#button', {
            'model-id': model.id
          })}
        />
      ) : null}
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
