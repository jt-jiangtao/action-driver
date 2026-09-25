import type { ModelOption } from '../../models/model-connections'
import type { ImageGenerationApi } from '@actiondriver/model-connections'
import { ModelStatusPill } from '../ModelStatusPill'
import { ModelToggle } from '../ModelToggle'
import { AppIcon } from '../ui/AppIcon'
import { IconButton } from '../ui/IconButton'
import { e2eId } from '../../testing/e2e-id'

export function LibraryModelRow({
  model,
  onTest,
  onToggle,
  imageSupported,
  onToggleImageInput,
  onToggleImageGeneration,
  onChangeImageGenerationApi,
  isDefaultImageModel,
  onToggleDefaultImageModel
}: {
  model: ModelOption
  onTest(): void
  onToggle(enabled: boolean): void
  imageSupported: boolean
  onToggleImageInput(enabled: boolean): void
  onToggleImageGeneration(enabled: boolean): void
  onChangeImageGenerationApi(api: ImageGenerationApi): void
  isDefaultImageModel: boolean
  onToggleDefaultImageModel(): void
}) {
  return (
    <div className="model-row">
      <span className="model-name-cell">
        <AppIcon name="cpu" />
        {model.name}
      </span>
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
      <ModelToggle
        label={`${model.name} 支持图片输入`}
        checked={model.imageInputEnabled === true}
        disabled={!imageSupported || !model.enabled}
        onChange={onToggleImageInput}
        testId={e2eId('e2e/settings/model-connections/models/:model-id/image-input#switch', {
          'model-id': model.id
        })}
      />
      <ModelToggle
        label={`${model.name} 支持图片生成`}
        checked={model.imageGenerationEnabled === true}
        disabled={!imageSupported || !model.enabled}
        onChange={onToggleImageGeneration}
        testId={e2eId('e2e/settings/model-connections/models/:model-id/image-generation#switch', {
          'model-id': model.id
        })}
      />
      {model.imageGenerationEnabled && model.enabled ? (
        <select
          className="model-image-api"
          aria-label={`${model.name} 生图接口`}
          data-testid={e2eId('e2e/settings/model-connections/models/:model-id/image-api#select', {
            'model-id': model.id
          })}
          value={model.imageGenerationApi ?? 'openai-images'}
          onChange={(event) => onChangeImageGenerationApi(event.target.value as ImageGenerationApi)}
        >
          <option value="openai-images">Images API</option>
          <option value="token-plan">Token Plan</option>
        </select>
      ) : (
        <span className="model-image-default-empty">—</span>
      )}
      {model.imageGenerationEnabled && model.enabled ? (
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
      ) : (
        <span className="model-image-default-empty">—</span>
      )}
    </div>
  )
}
