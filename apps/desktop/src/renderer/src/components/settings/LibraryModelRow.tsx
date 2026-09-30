import type { ModelOption } from '../../models/model-connections'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { e2eId } from '../../testing/e2e-id'
import { ModelCapabilityResults } from './ModelCapabilityResults'

export function LibraryModelRow({
  model,
  onTest,
  onToggle,
  isDefaultImageModel,
  onToggleDefaultImageModel,
  testing: externalTesting = false,
  requestError,
  testDisabled = false
}: {
  model: ModelOption
  onTest(): void
  onToggle(enabled: boolean): void
  isDefaultImageModel: boolean
  onToggleDefaultImageModel(): void
  testing?: boolean
  requestError?: string | undefined
  testDisabled?: boolean
}) {
  const imageReady = model.capabilities?.image_generation?.state === 'success'
  const testing =
    externalTesting ||
    model.testState === 'testing' ||
    Object.values(model.capabilities ?? {}).some((result) => result?.state === 'testing')
  return (
    <div className="model-row">
      <span className="model-name-cell">
        <AppIcon name="cpu" />
        {model.name}
      </span>
      <span className="model-state-cell">
        <ModelCapabilityResults
          capabilities={model.capabilities}
          probeCandidates={model.probeCandidates}
          catalogLabels={model.catalogLabels}
          testing={testing}
          requestFailed={Boolean(requestError)}
        />
      </span>
      <span className="model-row-actions">
        {model.probeCandidates?.length === 0 ||
        (model.probeCandidates === undefined && model.catalogLabels?.length) ? null : (
          <IconButton
            aria-label={`测试${model.name}`}
            title="逐项测试模型能力；指定 Token Plan 模型每次生图测试最多生成两张图片，可能产生费用"
            className="plain-icon-action model-test-action"
            disabled={testing || testDisabled}
            icon="play"
            testId={e2eId('e2e/settings/model-connections/models/:model-id/test#button', {
              'model-id': model.id
            })}
            onClick={onTest}
          />
        )}
        <ModelToggle
          label={`启用${model.name}`}
          checked={model.enabled}
          onChange={onToggle}
          testId={e2eId('e2e/settings/model-connections/models/:model-id/toggle#switch', {
            'model-id': model.id
          })}
        />
        {imageReady && model.enabled ? (
          <button
            type="button"
            className={`model-image-default${isDefaultImageModel ? ' is-selected' : ''}`}
            aria-label={`${isDefaultImageModel ? '取消默认生图模型' : '设为默认生图模型'}：${model.name}`}
            aria-pressed={isDefaultImageModel}
            data-testid={e2eId(
              'e2e/settings/model-connections/models/:model-id/default-image#button',
              { 'model-id': model.id }
            )}
            onClick={onToggleDefaultImageModel}
          >
            {isDefaultImageModel ? '默认' : '设为默认'}
          </button>
        ) : null}
      </span>
    </div>
  )
}
