import type { ModelOption } from '../../models/model-connections'
import { ModelStatusPill } from '../ModelStatusPill'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'

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
        value={model.name}
        onChange={(event) => onChangeName(event.currentTarget.value)}
      />
      <ModelStatusPill state={model.testState} />
      <IconButton aria-label={`测试${model.name}`} icon="play" onClick={onTest} />
      <ModelToggle label={`选择${model.name}`} checked={model.enabled} onChange={onToggle} />
    </div>
  )
}
