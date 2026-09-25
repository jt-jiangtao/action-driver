import type { ModelOption } from '../../models/model-connections'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { e2eId } from '../../testing/e2e-id'
import { ModelCapabilityResults } from './ModelCapabilityResults'

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
      <ModelCapabilityResults
        capabilities={model.capabilities}
        probeCandidates={model.probeCandidates}
        catalogLabels={model.catalogLabels}
        testing={model.testState === 'testing'}
      />
      {model.probeCandidates?.length === 0 ||
      (model.probeCandidates === undefined && model.catalogLabels?.length) ? null : (
        <IconButton
          aria-label={`测试${model.name}`}
          className="plain-icon-action"
          disabled={model.testState === 'testing'}
          icon="play"
          testId={e2eId('e2e/settings/add-model-set/models/:model-id/test#button', {
            'model-id': model.id
          })}
          onClick={onTest}
        />
      )}
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
